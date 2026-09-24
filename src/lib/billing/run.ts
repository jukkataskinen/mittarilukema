import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { calculateBill } from "./calculate";
import { loadOrgBillingData } from "./load";

export class BillingRunError extends Error {}

/**
 * Laskutusajo: jakson lasku jokaiselle kiinteistölle, jolla on jaksolla
 * voimassa oleva liittymä. Maksaja on jakson lopussa voimassa olevan
 * laskutettavan sopimuksen asiakas. Maksajan vaihtuminen kesken jakson ja
 * puuttuva maksaja jäävät laskulle huomautuksiksi, eikä laskua jaeta
 * automaattisesti (loppulasku tehdään erikseen).
 *
 * Ajetaan käyttäjän RLS-transaktiossa. Laskut ja rivit tallennetaan
 * joukkokyselyinä, jotta ajo mahtuu palvelinfunktion aikarajaan.
 */
export async function createBillingRun(
  tx: Sql,
  input: {
    organizationId: string; userId: string; periodStart: string; periodEnd: string; note?: string | null;
    /** all = kaikki kiinteistöt, no_area = ilman aluetta, muuten alueen tunniste. */
    scope?: "all" | "no_area" | { areaId: string };
  },
): Promise<{ runId: string; invoices: number; withIssues: number }> {
  const { organizationId: orgId, periodStart: start, periodEnd: end } = input;
  if (end <= start) throw new BillingRunError("Jakson loppu on ennen alkua.");
  const scope = input.scope ?? "all";
  const scopeName = typeof scope === "object" ? "area" : scope;
  const areaId = typeof scope === "object" ? scope.areaId : null;

  const existing = await tx.query(
    `select 1 from ml_billing_runs where organization_id = $1 and period_start = $2 and period_end = $3
        and scope = $4 and area_id is not distinct from $5`,
    [orgId, start, end, scopeName, areaId],
  );
  if (existing.length) throw new BillingRunError("Tälle jaksolle ja rajaukselle on jo laskutusajo. Poista luonnos ensin, jos haluat laskea uudelleen.");

  const [run] = await tx.query<{ id: string }>(
    "insert into ml_billing_runs (organization_id, period_start, period_end, scope, area_id, note, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [orgId, start, end, scopeName, areaId, input.note ?? null, input.userId],
  );

  const { properties, tariffs } = await loadOrgBillingData(tx, orgId);
  const contracts = await tx.query<{ id: string; property_id: string; customer_id: string; starts_on: string; ends_on: string | null }>(
    `select id, property_id, customer_id, starts_on::text, ends_on::text from ml_contracts
      where organization_id = $1 and billed and starts_on <= $3 and (ends_on is null or ends_on > $2)`,
    [orgId, start, end],
  );
  const byProperty = new Map<string, typeof contracts>();
  for (const c of contracts) byProperty.set(c.property_id, [...(byProperty.get(c.property_id) ?? []), c]);

  const invoices: {
    property_id: string; customer_id: string | null; contract_id: string | null; water_m3: number; wastewater_m3: number;
    net_eur: number; vat_eur: number; gross_eur: number; usage: unknown; issues: string[];
  }[] = [];
  const lines: { property_id: string; line_no: number; kind: string; connection_kind: string; description: string; quantity: number; unit: string; unit_price: number; vat_percent: number; net_eur: number }[] = [];

  for (const p of properties.values()) {
    if (scopeName === "no_area" && p.areaId !== null) continue;
    if (scopeName === "area" && p.areaId !== areaId) continue;
    const activeConn = p.connections.some((c) => c.connectedOn <= end && (c.disconnectedOn === null || c.disconnectedOn > start));
    if (!activeConn) continue;
    const res = calculateBill({ periodStart: start, periodEnd: end, areaId: p.areaId, connections: p.connections, meters: p.meters, tariffs });
    const cs = byProperty.get(p.propertyId) ?? [];
    const payer = cs.find((c) => c.starts_on <= end && (c.ends_on === null || c.ends_on >= end)) ?? null;
    const issues = [...res.issues];
    if (!payer) issues.push("Laskutettava sopimus puuttuu jakson lopussa.");
    if (new Set(cs.map((c) => c.customer_id)).size > 1) issues.push("Maksaja vaihtunut jaksolla: tarkista, onko edelliselle maksajalle tehty loppulasku.");
    invoices.push({
      property_id: p.propertyId,
      customer_id: payer?.customer_id ?? null,
      contract_id: payer?.id ?? null,
      water_m3: res.waterM3,
      wastewater_m3: res.wastewaterM3,
      net_eur: res.net,
      vat_eur: res.vat,
      gross_eur: res.gross,
      usage: res.usage,
      issues,
    });
    res.lines.forEach((l, i) =>
      lines.push({
        property_id: p.propertyId, line_no: i + 1, kind: l.kind, connection_kind: l.connectionKind, description: l.description,
        quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice, vat_percent: l.vatPercent, net_eur: l.net,
      }),
    );
  }

  if (invoices.length) {
    const inserted = await tx.query<{ id: string; property_id: string }>(
      `insert into ml_invoices (organization_id, run_id, property_id, customer_id, contract_id, water_m3, wastewater_m3, net_eur, vat_eur, gross_eur, usage, issues)
       select $1, $2, x.property_id, x.customer_id, x.contract_id, x.water_m3, x.wastewater_m3, x.net_eur, x.vat_eur, x.gross_eur, x.usage,
              array(select json_array_elements_text(x.issues))
         from json_to_recordset($3::json) as x(property_id uuid, customer_id uuid, contract_id uuid, water_m3 numeric, wastewater_m3 numeric,
              net_eur numeric, vat_eur numeric, gross_eur numeric, usage jsonb, issues json)
       returning id, property_id`,
      [orgId, run.id, JSON.stringify(invoices)],
    );
    const idOf = new Map(inserted.map((r) => [r.property_id, r.id]));
    if (lines.length) {
      await tx.query(
        `insert into ml_invoice_lines (organization_id, invoice_id, line_no, kind, connection_kind, description, quantity, unit, unit_price, vat_percent, net_eur)
         select $1, x.invoice_id, x.line_no, x.kind, x.connection_kind, x.description, x.quantity, x.unit, x.unit_price, x.vat_percent, x.net_eur
           from json_to_recordset($2::json) as x(invoice_id uuid, line_no smallint, kind text, connection_kind text, description text,
                quantity numeric, unit text, unit_price numeric, vat_percent numeric, net_eur numeric)`,
        [orgId, JSON.stringify(lines.map((l) => ({ ...l, invoice_id: idOf.get(l.property_id) })))],
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
