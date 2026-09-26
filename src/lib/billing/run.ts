import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { billingMonths, calculateBill, estimateAnnualM3, type BilledEstimate, type ConnectionKind } from "./calculate";
import { loadOrgBillingData } from "./load";
import { invoiceInfo } from "./info";
import { changeBoundaries, partiesOn, splitByParty, type PartyContract } from "./parties";
import { loadProducts, resolveProduct, toResolved } from "@/lib/products";

export class BillingRunError extends Error {}

const DAY = 86_400_000;
const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const fmt3 = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
const fi = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};

/**
 * Laskutusajo: jakson lasku jokaiselle kiinteistölle, jolla on jaksolla
 * voimassa oleva liittymä. Rivit jaetaan osapuolille (parties.ts):
 * omistaja liittymissopimuksella, vuokralainen käyttösopimuksen osista ja
 * lainaosuus lainan velalliselle. Osapuolet ovat jakson lopussa voimassa
 * olevat; arviolaskussa jakson ensimmäisenä päivänä voimassa olevat, jolloin
 * kuukausimaksut vaihtuvat vaihtoa seuraavan kuun alusta.
 *
 * Jos osapuolet vaihtuvat kesken toteutuneen kulutuksen jakson ja
 * vaihtopäivältä on lukema, lasku jaetaan vaihtopäivästä. Perusmaksun
 * kuukausi kuuluu sille, jonka osajaksolle kuun 1. päivä osuu. Muuten lasku
 * jää yhdeksi ja siihen tulee huomautus.
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

  const { properties, tariffs, estimateBasis } = await loadOrgBillingData(tx, orgId);
  // Tuote, tili ja laskentakohde riveille (0024). Asiakasryhmä valitsee esim. kunnan tuotteet.
  const products = await loadProducts(tx, orgId);
  const customerGroups = new Map(
    (await tx.query<{ id: string; customer_group: string | null }>("select id, customer_group from ml_customers where organization_id = $1 and customer_group is not null", [orgId]))
      .map((c) => [c.id, c.customer_group]),
  );
  const contracts = await tx.query<PartyContract & { property_id: string }>(
    `select id, property_id, customer_id, role, starts_on::text, ends_on::text, tenant_components from ml_contracts
      where organization_id = $1 and billed and starts_on <= $3 and (ends_on is null or ends_on > $2)`,
    [orgId, start, end],
  );
  // Tasaus: jaksolla hyväksytyillä arviolaskuilla jo laskutettu kulutus ja summa kiinteistöittäin ja liittymälajeittain.
  const billedEstimates = new Map<string, Partial<Record<ConnectionKind, BilledEstimate>>>();
  const reviewEstimates = new Set<string>();
  if (kind === "settlement") {
    // Hyväksytyt Mittarilukeman arviolaskut ja vanhassa järjestelmässä laskutetut arviot (0019).
    // Vanhan järjestelmän kuukautta ei lasketa, jos samalle kuukaudelle on hyväksytty arviolasku.
    const rows = await tx.query<{ property_id: string; connection_kind: ConnectionKind; m3: string; net: string; gross: string; review: number }>(
      `select property_id, connection_kind, sum(m3)::text as m3, sum(net)::text as net, sum(gross)::text as gross, sum(review)::int as review
         from (
           select i.property_id, l.connection_kind, l.quantity as m3, l.net_eur as net,
                  l.net_eur + coalesce(l.vat_eur, round(l.net_eur * l.vat_percent / 100, 2)) as gross, 0 as review
             from ml_invoice_lines l
             join ml_invoices i on i.id = l.invoice_id
             join ml_billing_runs r on r.id = i.run_id
            where r.organization_id = $1 and r.kind = 'estimate' and r.status = 'approved' and i.status <> 'excluded'
              and i.period_start >= $2 and i.period_end <= $3 and l.kind = 'usage' and l.connection_kind is not null
           union all
           select e.property_id, e.connection_kind, e.m3, e.net_eur, e.gross_eur, case when e.needs_review then 1 else 0 end
             from ml_legacy_billed_estimates e
            where e.organization_id = $1 and e.month > $2 and e.month <= $3
              and not exists (
                select 1 from ml_invoices i join ml_billing_runs r on r.id = i.run_id
                 where r.kind = 'estimate' and r.status = 'approved' and i.status <> 'excluded' and i.property_id = e.property_id
                   and i.period_start < e.month and i.period_end >= (e.month + interval '1 month' - interval '1 day')::date)
         ) x
        group by property_id, connection_kind`,
      [orgId, start, end],
    );
    for (const r of rows) {
      const m = billedEstimates.get(r.property_id) ?? {};
      m[r.connection_kind] = { m3: Number(r.m3), net: Number(r.net), gross: Number(r.gross) };
      billedEstimates.set(r.property_id, m);
      if (r.review) reviewEstimates.add(r.property_id);
    }
  }
  const byProperty = new Map<string, typeof contracts>();
  for (const c of contracts) byProperty.set(c.property_id, [...(byProperty.get(c.property_id) ?? []), c]);

  type InvoiceRow = {
    key: string; property_id: string; customer_id: string | null; contract_id: string | null; period_start: string; period_end: string;
    water_m3: number; wastewater_m3: number; net_eur: number; vat_eur: number; gross_eur: number; usage: unknown; issues: string[]; info: string | null;
    estimate_annual_m3?: number | null; estimate_source?: "history" | "manual" | null;
  };
  const invoices: InvoiceRow[] = [];
  const lines: {
    key: string; line_no: number; kind: string; connection_kind: string | null; description: string; quantity: number; unit: string;
    unit_price: number; vat_percent: number; net_eur: number; vat_eur: number; price_includes_vat: boolean;
    product_code: string | null; account_code: string | null; cost_center_code: string | null;
  }[] = [];

  for (const p of properties.values()) {
    if (scopeName === "no_area" && p.areaId !== null) continue;
    if (scopeName === "area" && p.areaId !== areaId) continue;
    if (scopeName === "except_area" && p.areaId === areaId) continue;
    const activeConn = p.connections.some((c) => c.connectedOn <= end && (c.disconnectedOn === null || c.disconnectedOn > start));
    // Kiinteistö ilman liittymää laskutetaan, jos sillä on omia maksuja tai lainaosuus (Kärkinen: liittymättömän lainaosuus).
    if (!activeConn && (kind === "settlement" || (p.charges.length === 0 && p.loans.length === 0))) continue;
    const cs = [...(byProperty.get(p.propertyId) ?? [])].sort((x, y) => x.starts_on.localeCompare(y.starts_on));
    // Arviolasku: vuosikulutusarvio edellisen vuoden lukemista, muuten käsin annettu arvio.
    // Organisaatio voi valita käsin annetun arvion ensisijaiseksi (Kärkinen päättää kuukausiarviot itse).
    const manualFirst = estimateBasis === "manual" && p.estimatedAnnualM3 !== null;
    const history = kind === "estimate" && !manualFirst ? estimateAnnualM3(p.meters, start) : null;
    const annual = kind === "estimate" ? (history ?? p.estimatedAnnualM3) : null;
    const estimateSource = history !== null ? "history" : annual !== null ? "manual" : null;
    const months = billingMonths(start, end).length;
    const billed = billedEstimates.get(p.propertyId);
    const billedEstimate = Math.max(billed?.water?.m3 ?? 0, billed?.wastewater?.m3 ?? 0);
    const calc = (s0: string, e0: string, windowDays?: number) =>
      calculateBill({
        periodStart: s0, periodEnd: e0, areaId: p.areaId, connections: p.connections, meters: p.meters, tariffs, readingWindowDays: windowDays,
        mode: kind, estimateM3: annual !== null ? Math.round(((annual * months) / 12) * 1000) / 1000 : 0, billedEstimates: billed,
        propertyCharges: p.charges, loans: p.loans,
      });
    // Jakson rivit osapuolten laskuiksi. Kulutus, lukemat ja huomautukset tulevat
    // laskulle, jolla on kulutusrivit (tai ensimmäiselle, jos niitä ei ole).
    const push = (s0: string, e0: string, res: ReturnType<typeof calculateBill>, partial: boolean, extraIssues: string[]) => {
      const parties = partiesOn(cs, kind === "estimate" ? addDay(s0) : e0);
      const split = splitByParty(res.lines, parties, p.loans, cs);
      const readingInfo = kind === "estimate" ? "" : invoiceInfo({ usage: res.usage, meters: p.meters, legacyId: p.legacyId, address: p.streetAddress });
      const periodNote = partial ? `Laskutusjakso ${fi(addDay(s0))} - ${fi(e0)} (osapuolten vaihdos).` : "";
      const place = p.legacyId ? `Unes: ${p.legacyId} / ${p.streetAddress}` : p.streetAddress;
      const kindNote =
        kind === "estimate" && annual !== null
          ? `Arviolasku ${fi(addDay(s0))} - ${fi(e0)}: arvioitu vuosikulutus ${fmt3(annual)} m3 (${estimateSource === "history" ? "edellisen vuoden kulutus" : "annettu arvio"}), ${place}`
          : kind === "settlement"
            ? `Tasaus ${fi(addDay(s0))} - ${fi(e0)}: toteutunut ${fmt3(Math.max(res.waterM3, res.wastewaterM3))} m3, arviolaskuilla laskutettu ${fmt3(billedEstimate)} m3.`
            : "";
      const issues = [...res.issues, ...extraIssues, ...split.issues];
      if (!parties.owner && !parties.tenant) issues.push("Laskutettava sopimus puuttuu jakson lopussa.");
      for (const part of split.invoices) {
        const key = `${p.propertyId}|${e0}|${part.customerId ?? ""}`;
        const roleNote =
          part.role === "tenant" && split.invoices.length > 1 ? `Käyttösopimuksen mukaiset maksut, ${place}` :
          part.role === "debtor" ? `Lainaosuus, ${place}. Laina ei ole siirtynyt käyttöpaikan uudelle omistajalle.` :
          part.role === "owner" && split.invoices.length > 1 && !part.primary ? `Liittymissopimuksen mukaiset maksut, ${place}` : "";
        const net = round2(part.lines.reduce((x, l) => x + l.net, 0));
        const vat = round2(part.lines.reduce((x, l) => x + l.vat, 0));
        invoices.push({
          key, property_id: p.propertyId, customer_id: part.customerId, contract_id: part.contractId, period_start: s0, period_end: e0,
          water_m3: part.primary ? res.waterM3 : 0, wastewater_m3: part.primary ? res.wastewaterM3 : 0,
          net_eur: net, vat_eur: vat, gross_eur: round2(net + vat), usage: part.primary ? res.usage : [],
          issues: part.primary ? issues : [],
          info: [periodNote, roleNote, kindNote, part.primary ? readingInfo : ""].filter(Boolean).join("\n") || null,
          estimate_annual_m3: annual, estimate_source: estimateSource,
        });
        const lineCtx = {
          areaId: p.areaId,
          customerGroup: part.customerId ? (customerGroups.get(part.customerId) ?? null) : null,
          metered: p.meters.some((m) => m.installedOn <= e0 && (m.removedOn === null || m.removedOn > s0)),
        };
        part.lines.forEach((l, i) => {
          const prod = toResolved(products.length ? resolveProduct(products, l, lineCtx) : null);
          lines.push({
            key, line_no: i + 1, kind: l.kind, connection_kind: l.connectionKind, description: l.description,
            quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice, vat_percent: l.vatPercent, net_eur: l.net,
            vat_eur: Math.round(l.vat * 100) / 100, price_includes_vat: l.priceIncludesVat,
            product_code: prod.productCode, account_code: prod.accountCode, cost_center_code: prod.costCenterCode,
          });
        });
        // Organisaatiolla on tuoterekisteri, mutta rivi jäi ilman tuotetta: kirjanpito tarvitsee sen.
        const unmatched = products.length ? part.lines.filter((l) => !resolveProduct(products, l, lineCtx)).map((l) => l.description) : [];
        if (unmatched.length) {
          invoices[invoices.length - 1].issues.push(`Riville ei löytynyt tuotetta (${[...new Set(unmatched)].join(", ")}). Tarkista tuoterekisterin säännöt.`);
        }
      }
    };

    // Osapuolten vaihdos jaksolla: jaetaan laskut vaihtopäivistä, jos niiltä on
    // lukema (±14 pv). Muuten yksi lasku ja huomautus. Vain toteutuneen
    // kulutuksen laskussa; arviolasku seuraa kuukauden ensimmäistä päivää ja
    // tasauksen jako tehdään käsin.
    const boundaries = kind === "estimate" ? [] : changeBoundaries(cs, start, end);
    if (kind === "actual" && boundaries.length) {
      const ends = [...boundaries, end];
      const segments = ends.map((e0, i) => ({ s0: i === 0 ? start : ends[i - 1], e0 }));
      const results = segments.map((g, i) => calc(g.s0, g.e0, i === segments.length - 1 ? undefined : 14));
      const splitOk = results.slice(0, -1).every((r) => !r.issues.some((x) => x.includes("lukema puuttuu")));
      if (splitOk) {
        segments.forEach((g, i) => push(g.s0, g.e0, results[i], true, []));
        continue;
      }
    }

    const res = calc(start, end);
    const extra: string[] = [];
    if (kind === "estimate") {
      // Arviolaskulla mittariin liittyviä huomautuksia ei tarvita.
      res.issues = res.issues.filter((x) => !x.includes("mittari"));
      if (annual === null && activeConn) extra.push("Vuosikulutusarvio puuttuu: lukemia alle puolelta vuodelta eikä kiinteistölle ole annettu arviota.");
    }
    if (kind === "settlement" && billedEstimate === 0) extra.push("Tasausjaksolta ei löytynyt hyväksyttyjä arviolaskuja.");
    if (kind === "settlement" && reviewEstimates.has(p.propertyId)) {
      extra.push("Osa vanhan järjestelmän arvioista on päätelty epävarmasti (kuukausi ilman laskua). Tarkista arviot ennen tasausta.");
    }
    if (kind === "actual" && boundaries.length) {
      extra.push("Maksaja vaihtunut jaksolla, eikä vaihtopäivältä ole lukemaa: laskua ei voitu jakaa. Kirjaa vaihtopäivän lukema ja laske uudelleen.");
    }
    if (kind === "settlement" && boundaries.length) {
      extra.push("Osapuolet vaihtuneet tasausjaksolla: tasaus laskutettiin jakson lopun osapuolille. Tarkista jako ennen hyväksyntää.");
    }
    push(start, end, res, false, extra);
  }

  if (invoices.length) {
    const inserted = await tx.query<{ id: string; property_id: string; period_end: string; customer_id: string | null }>(
      `insert into ml_invoices (organization_id, run_id, property_id, customer_id, contract_id, period_start, period_end, water_m3, wastewater_m3,
                                net_eur, vat_eur, gross_eur, usage, issues, info, estimate_annual_m3, estimate_source)
       select $1, $2, x.property_id, x.customer_id, x.contract_id, x.period_start, x.period_end, x.water_m3, x.wastewater_m3,
              x.net_eur, x.vat_eur, x.gross_eur, x.usage, array(select json_array_elements_text(x.issues)), x.info, x.estimate_annual_m3, x.estimate_source
         from json_to_recordset($3::json) as x(property_id uuid, customer_id uuid, contract_id uuid, period_start date, period_end date,
              water_m3 numeric, wastewater_m3 numeric, net_eur numeric, vat_eur numeric, gross_eur numeric, usage jsonb, issues json, info text,
              estimate_annual_m3 numeric, estimate_source text)
       returning id, property_id, period_end::text, customer_id`,
      [orgId, run.id, JSON.stringify(invoices)],
    );
    const idOf = new Map(inserted.map((r) => [`${r.property_id}|${r.period_end}|${r.customer_id ?? ""}`, r.id]));
    if (lines.length) {
      await tx.query(
        `insert into ml_invoice_lines (organization_id, invoice_id, line_no, kind, connection_kind, description, quantity, unit, unit_price, vat_percent, net_eur,
                                       vat_eur, price_includes_vat, product_code, account_code, cost_center_code)
         select $1, x.invoice_id, x.line_no, x.kind, x.connection_kind, x.description, x.quantity, x.unit, x.unit_price, x.vat_percent, x.net_eur,
                x.vat_eur, x.price_includes_vat, x.product_code, x.account_code, x.cost_center_code
           from json_to_recordset($2::json) as x(invoice_id uuid, line_no smallint, kind text, connection_kind text, description text,
                quantity numeric, unit text, unit_price numeric, vat_percent numeric, net_eur numeric, vat_eur numeric, price_includes_vat boolean,
                product_code text, account_code text, cost_center_code text)`,
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
