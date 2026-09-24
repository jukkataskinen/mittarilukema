import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { billingMonths, calculateBill, estimateAnnualM3 } from "./calculate";
import { loadOrgBillingData } from "./load";
import { invoiceInfo } from "./info";

export class BillingRunError extends Error {}

const DAY = 86_400_000;
const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
const maxDate = (x: string, y: string) => (x > y ? x : y);
const minDate = (x: string, y: string) => (x < y ? x : y);
const fmt3 = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
const fi = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};

/**
 * Laskutusajo: jakson lasku jokaiselle kiinteistölle, jolla on jaksolla
 * voimassa oleva liittymä. Maksaja on jakson lopussa voimassa olevan
 * laskutettavan sopimuksen asiakas. Jos maksaja vaihtuu kesken jakson ja
 * vaihtopäivältä on lukema, edelliselle maksajalle tehdään loppulasku
 * vaihtopäivään asti ja uudelle lasku siitä eteenpäin. Muuten lasku jää
 * yhdeksi ja siihen tulee huomautus.
 *
 * Ajetaan käyttäjän RLS-transaktiossa. Laskut ja rivit tallennetaan
 * joukkokyselyinä, jotta ajo mahtuu palvelinfunktion aikarajaan.
 */
export async function createBillingRun(
  tx: Sql,
  input: {
    organizationId: string; userId: string; periodStart: string; periodEnd: string; note?: string | null;
    /** all = kaikki kiinteistöt, no_area = ilman aluetta, areaId = yksi alue, exceptAreaId = kaikki paitsi alue. */
    scope?: "all" | "no_area" | { areaId: string } | { exceptAreaId: string };
    /** actual = toteutunut kulutus, estimate = arviolasku, settlement = tasaus. */
    kind?: "actual" | "estimate" | "settlement";
  },
): Promise<{ runId: string; invoices: number; withIssues: number }> {
  const { organizationId: orgId, periodStart: start, periodEnd: end } = input;
  if (end <= start) throw new BillingRunError("Jakson loppu on ennen alkua.");
  const scope = input.scope ?? "all";
  const scopeName = typeof scope === "object" ? ("areaId" in scope ? "area" : "except_area") : scope;
  const areaId = typeof scope === "object" ? ("areaId" in scope ? scope.areaId : scope.exceptAreaId) : null;
  const kind = input.kind ?? "actual";

  const existing = await tx.query(
    `select 1 from ml_billing_runs where organization_id = $1 and period_start = $2 and period_end = $3
        and scope = $4 and area_id is not distinct from $5 and kind = $6`,
    [orgId, start, end, scopeName, areaId, kind],
  );
  if (existing.length) throw new BillingRunError("Tälle jaksolle ja rajaukselle on jo laskutusajo. Poista luonnos ensin, jos haluat laskea uudelleen.");

  const [run] = await tx.query<{ id: string }>(
    "insert into ml_billing_runs (organization_id, period_start, period_end, scope, area_id, note, created_by, kind) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
    [orgId, start, end, scopeName, areaId, input.note ?? null, input.userId, kind],
  );

  const { properties, tariffs } = await loadOrgBillingData(tx, orgId);
  const contracts = await tx.query<{ id: string; property_id: string; customer_id: string; starts_on: string; ends_on: string | null }>(
    `select id, property_id, customer_id, starts_on::text, ends_on::text from ml_contracts
      where organization_id = $1 and billed and starts_on <= $3 and (ends_on is null or ends_on > $2)`,
    [orgId, start, end],
  );
  // Tasaus: jaksolla hyväksytyillä arviolaskuilla jo laskutettu kulutus kiinteistöittäin.
  const billedEstimates = new Map<string, number>();
  if (kind === "settlement") {
    const rows = await tx.query<{ property_id: string; m3: string }>(
      `select i.property_id, sum(greatest(i.water_m3, i.wastewater_m3))::text as m3
         from ml_invoices i join ml_billing_runs r on r.id = i.run_id
        where r.organization_id = $1 and r.kind = 'estimate' and r.status = 'approved' and i.status <> 'excluded'
          and i.period_start >= $2 and i.period_end <= $3
        group by i.property_id`,
      [orgId, start, end],
    );
    for (const r of rows) billedEstimates.set(r.property_id, Number(r.m3));
  }
  const byProperty = new Map<string, typeof contracts>();
  for (const c of contracts) byProperty.set(c.property_id, [...(byProperty.get(c.property_id) ?? []), c]);

  type InvoiceRow = {
    key: string; property_id: string; customer_id: string | null; contract_id: string | null; period_start: string; period_end: string;
    water_m3: number; wastewater_m3: number; net_eur: number; vat_eur: number; gross_eur: number; usage: unknown; issues: string[]; info: string | null;
    estimate_annual_m3?: number | null; estimate_source?: "history" | "manual" | null;
  };
  const invoices: InvoiceRow[] = [];
  const lines: { key: string; line_no: number; kind: string; connection_kind: string | null; description: string; quantity: number; unit: string; unit_price: number; vat_percent: number; net_eur: number }[] = [];

  for (const p of properties.values()) {
    if (scopeName === "no_area" && p.areaId !== null) continue;
    if (scopeName === "area" && p.areaId !== areaId) continue;
    if (scopeName === "except_area" && p.areaId === areaId) continue;
    const activeConn = p.connections.some((c) => c.connectedOn <= end && (c.disconnectedOn === null || c.disconnectedOn > start));
    if (!activeConn) continue;
    const cs = [...(byProperty.get(p.propertyId) ?? [])].sort((x, y) => x.starts_on.localeCompare(y.starts_on));
    // Arviolasku: vuosikulutusarvio edellisen vuoden lukemista, muuten käsin annettu arvio.
    const history = kind === "estimate" ? estimateAnnualM3(p.meters, start) : null;
    const annual = kind === "estimate" ? (history ?? p.estimatedAnnualM3) : null;
    const estimateSource = history !== null ? "history" : annual !== null ? "manual" : null;
    const months = billingMonths(start, end).length;
    const billedEstimate = billedEstimates.get(p.propertyId) ?? 0;
    const calc = (s0: string, e0: string, windowDays?: number) =>
      calculateBill({
        periodStart: s0, periodEnd: e0, areaId: p.areaId, connections: p.connections, meters: p.meters, tariffs, readingWindowDays: windowDays,
        mode: kind, estimateM3: annual !== null ? Math.round(((annual * months) / 12) * 1000) / 1000 : 0, billedEstimateM3: billedEstimate,
      });
    const push = (row: Omit<InvoiceRow, "key" | "info">, res: ReturnType<typeof calculateBill>, partial: boolean) => {
      const key = `${row.property_id}|${row.period_end}`;
      const readingInfo = kind === "estimate" ? "" : invoiceInfo({ usage: res.usage, meters: p.meters, legacyId: p.legacyId, address: p.streetAddress });
      const periodNote = partial ? `Laskutusjakso ${fi(addDay(row.period_start))} - ${fi(row.period_end)} (maksajan vaihdos).` : "";
      const place = p.legacyId ? `Unes: ${p.legacyId} / ${p.streetAddress}` : p.streetAddress;
      const kindNote =
        kind === "estimate" && annual !== null
          ? `Arviolasku ${fi(addDay(row.period_start))} - ${fi(row.period_end)}: arvioitu vuosikulutus ${fmt3(annual)} m3 (${estimateSource === "history" ? "edellisen vuoden kulutus" : "annettu arvio"}), ${place}`
          : kind === "settlement"
            ? `Tasaus: arviolaskuilla laskutettu ${fmt3(billedEstimate)} m3, toteutunut ${fmt3(Math.max(res.waterM3, res.wastewaterM3) + billedEstimate)} m3.`
            : "";
      invoices.push({
        ...row, key, info: [periodNote, kindNote, readingInfo].filter(Boolean).join("\n") || null,
        estimate_annual_m3: annual, estimate_source: estimateSource,
      });
      res.lines.forEach((l, i) =>
        lines.push({
          key, line_no: i + 1, kind: l.kind, connection_kind: l.connectionKind, description: l.description,
          quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice, vat_percent: l.vatPercent, net_eur: l.net,
        }),
      );
    };

    // Maksajan vaihdos jaksolla: jaetaan laskut sopimusten rajoista, jos
    // vaihtopäivältä on lukema (±14 pv). Muuten yksi lasku ja huomautus.
    // Vain toteutuneen kulutuksen laskussa; arviolaskun ja tasauksen jako tehdään käsin.
    if (kind === "actual" && new Set(cs.map((c) => c.customer_id)).size > 1) {
      const segments = cs.map((c, i) => ({
        contract: c,
        s0: i === 0 ? start : maxDate(start, dayBefore(c.starts_on)),
        e0: i === cs.length - 1 ? end : minDate(end, c.ends_on ?? end),
      })).filter((g) => g.e0 > g.s0);
      const results = segments.map((g, i) => calc(g.s0, g.e0, i === segments.length - 1 ? undefined : 14));
      const splitOk = segments.length > 1 && results.slice(0, -1).every((r) => !r.issues.some((x) => x.includes("lukema puuttuu")));
      if (splitOk) {
        segments.forEach((g, i) =>
          push({
            property_id: p.propertyId, customer_id: g.contract.customer_id, contract_id: g.contract.id, period_start: g.s0, period_end: g.e0,
            water_m3: results[i].waterM3, wastewater_m3: results[i].wastewaterM3, net_eur: results[i].net, vat_eur: results[i].vat,
            gross_eur: results[i].gross, usage: results[i].usage, issues: results[i].issues,
          }, results[i], true),
        );
        continue;
      }
    }

    const res = calc(start, end);
    const payer = cs.find((c) => c.starts_on <= end && (c.ends_on === null || c.ends_on >= end)) ?? null;
    const issues = [...res.issues].filter((x) => kind !== "estimate" || !x.includes("mittari"));
    if (!payer) issues.push("Laskutettava sopimus puuttuu jakson lopussa.");
    if (kind === "estimate" && annual === null) issues.push("Vuosikulutusarvio puuttuu: lukemia alle puolelta vuodelta eikä kiinteistölle ole annettu arviota.");
    if (kind === "settlement" && billedEstimate === 0) issues.push("Tasausjaksolta ei löytynyt hyväksyttyjä arviolaskuja.");
    if (new Set(cs.map((c) => c.customer_id)).size > 1) {
      issues.push("Maksaja vaihtunut jaksolla, eikä vaihtopäivältä ole lukemaa: laskua ei voitu jakaa. Kirjaa vaihtopäivän lukema ja laske uudelleen.");
    }
    push({
      property_id: p.propertyId, customer_id: payer?.customer_id ?? null, contract_id: payer?.id ?? null, period_start: start, period_end: end,
      water_m3: res.waterM3, wastewater_m3: res.wastewaterM3, net_eur: res.net, vat_eur: res.vat, gross_eur: res.gross, usage: res.usage, issues,
    }, res, false);
  }

  if (invoices.length) {
    const inserted = await tx.query<{ id: string; property_id: string; period_end: string }>(
      `insert into ml_invoices (organization_id, run_id, property_id, customer_id, contract_id, period_start, period_end, water_m3, wastewater_m3,
                                net_eur, vat_eur, gross_eur, usage, issues, info, estimate_annual_m3, estimate_source)
       select $1, $2, x.property_id, x.customer_id, x.contract_id, x.period_start, x.period_end, x.water_m3, x.wastewater_m3,
              x.net_eur, x.vat_eur, x.gross_eur, x.usage, array(select json_array_elements_text(x.issues)), x.info, x.estimate_annual_m3, x.estimate_source
         from json_to_recordset($3::json) as x(property_id uuid, customer_id uuid, contract_id uuid, period_start date, period_end date,
              water_m3 numeric, wastewater_m3 numeric, net_eur numeric, vat_eur numeric, gross_eur numeric, usage jsonb, issues json, info text,
              estimate_annual_m3 numeric, estimate_source text)
       returning id, property_id, period_end::text`,
      [orgId, run.id, JSON.stringify(invoices)],
    );
    const idOf = new Map(inserted.map((r) => [`${r.property_id}|${r.period_end}`, r.id]));
    if (lines.length) {
      await tx.query(
        `insert into ml_invoice_lines (organization_id, invoice_id, line_no, kind, connection_kind, description, quantity, unit, unit_price, vat_percent, net_eur)
         select $1, x.invoice_id, x.line_no, x.kind, x.connection_kind, x.description, x.quantity, x.unit, x.unit_price, x.vat_percent, x.net_eur
           from json_to_recordset($2::json) as x(invoice_id uuid, line_no smallint, kind text, connection_kind text, description text,
                quantity numeric, unit text, unit_price numeric, vat_percent numeric, net_eur numeric)`,
        [orgId, JSON.stringify(lines.map((l) => ({ ...l, invoice_id: idOf.get(l.key) })))],
      );
    }
  }

  const withIssues = invoices.filter((i) => i.issues.length).length;
  await audit(tx, {
    organizationId: orgId, userId: input.userId, action: "billing_run.create", entity: "ml_billing_runs", entityId: run.id,
    details: { periodStart: start, periodEnd: end, invoices: invoices.length, withIssues },
  });
  return { runId: run.id, invoices: invoices.length, withIssues };
}

export async function approveBillingRun(tx: Sql, input: { organizationId: string; userId: string; runId: string }): Promise<boolean> {
  const rows = await tx.query(
    "update ml_billing_runs set status = 'approved', approved_by = $3, approved_at = now() where id = $1 and organization_id = $2 and status = 'draft' returning id",
    [input.runId, input.organizationId, input.userId],
  );
  if (!rows.length) return false;
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "billing_run.approve", entity: "ml_billing_runs", entityId: input.runId });
  return true;
}

export async function deleteDraftRun(tx: Sql, input: { organizationId: string; userId: string; runId: string }): Promise<boolean> {
  const rows = await tx.query("delete from ml_billing_runs where id = $1 and organization_id = $2 and status = 'draft' returning id", [
    input.runId,
    input.organizationId,
  ]);
  if (!rows.length) return false;
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "billing_run.delete", entity: "ml_billing_runs", entityId: input.runId });
  return true;
}

export async function setInvoiceExcluded(
  tx: Sql,
  input: { organizationId: string; userId: string; invoiceId: string; excluded: boolean; reason?: string | null },
): Promise<boolean> {
  const rows = await tx.query(
    "update ml_invoices set status = $3, excluded_reason = $4 where id = $1 and organization_id = $2 returning id",
    [input.invoiceId, input.organizationId, input.excluded ? "excluded" : "draft", input.excluded ? (input.reason ?? null) : null],
  );
  if (!rows.length) return false;
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: input.excluded ? "invoice.exclude" : "invoice.include",
    entity: "ml_invoices", entityId: input.invoiceId,
  });
  return true;
}
