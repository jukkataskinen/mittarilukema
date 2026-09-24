import type { Sql } from "@/lib/db/types";

export interface RunRow {
  id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "approved";
  scope: "all" | "area" | "no_area" | "except_area";
  area_id: string | null;
  area_name: string | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  invoices: number;
  excluded: number;
  with_issues: number;
  net_eur: string;
  gross_eur: string;
  water_m3: string;
}

const RUN_SELECT = `
  select r.id, r.period_start::text, r.period_end::text, r.status, r.scope, r.area_id, a.name as area_name, r.note, r.created_at, r.approved_at,
         coalesce(cu.full_name, cu.email) as created_by_name, coalesce(au.full_name, au.email) as approved_by_name,
         count(i.id)::int as invoices,
         count(i.id) filter (where i.status = 'excluded')::int as excluded,
         count(i.id) filter (where i.status <> 'excluded' and cardinality(i.issues) > 0)::int as with_issues,
         coalesce(sum(i.net_eur) filter (where i.status <> 'excluded'), 0)::text as net_eur,
         coalesce(sum(i.gross_eur) filter (where i.status <> 'excluded'), 0)::text as gross_eur,
         coalesce(sum(greatest(i.water_m3, i.wastewater_m3)) filter (where i.status <> 'excluded'), 0)::text as water_m3
    from ml_billing_runs r
    left join ml_invoices i on i.run_id = r.id
    left join ml_users cu on cu.id = r.created_by
    left join ml_users au on au.id = r.approved_by
    left join ml_areas a on a.id = r.area_id`;

export function listRuns(tx: Sql, orgId: string) {
  return tx.query<RunRow>(`${RUN_SELECT} where r.organization_id = $1 group by r.id, cu.id, au.id, a.id order by r.period_end desc, r.created_at desc`, [orgId]);
}

export async function getRun(tx: Sql, orgId: string, id: string) {
  const [run] = await tx.query<RunRow>(`${RUN_SELECT} where r.organization_id = $1 and r.id = $2 group by r.id, cu.id, au.id, a.id`, [orgId, id]);
  return run ?? null;
}

export function scopeLabel(r: Pick<RunRow, "scope" | "area_name">): string {
  if (r.scope === "all") return "Kaikki kiinteistöt";
  if (r.scope === "no_area") return "Kiinteistöt ilman aluetta";
  if (r.scope === "except_area") return `Kaikki paitsi ${r.area_name}`;
  return `Alue: ${r.area_name}`;
}

export interface InvoiceListRow {
  id: string;
  property_id: string;
  street_address: string;
  legacy_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_number: string | null;
  status: "draft" | "excluded";
  water_m3: string;
  net_eur: string;
  gross_eur: string;
  issues: string[];
}

export function listRunInvoices(tx: Sql, orgId: string, runId: string, filter: "all" | "issues" | "excluded" = "all", q?: string) {
  const like = q?.trim() ? `%${q.trim().toLowerCase()}%` : null;
  return tx.query<InvoiceListRow>(
    `select i.id, i.property_id, p.street_address, p.legacy_id, i.customer_id, c.name as customer_name, c.customer_number,
            i.status, greatest(i.water_m3, i.wastewater_m3)::text as water_m3, i.net_eur::text, i.gross_eur::text, i.issues
       from ml_invoices i
       join ml_properties p on p.id = i.property_id
       left join ml_customers c on c.id = i.customer_id
      where i.organization_id = $1 and i.run_id = $2
        and ($3 = 'all' or ($3 = 'issues' and i.status <> 'excluded' and cardinality(i.issues) > 0) or ($3 = 'excluded' and i.status = 'excluded'))
        and ($4::text is null or lower(p.street_address) like $4 or lower(coalesce(c.name, '')) like $4
             or coalesce(c.customer_number, '') like $4 or coalesce(p.legacy_id, '') like $4)
      order by p.street_address`,
    [orgId, runId, filter, like],
  );
}

export async function getInvoice(tx: Sql, orgId: string, id: string) {
  const [invoice] = await tx.query<{
    id: string; run_id: string; property_id: string; street_address: string; postal_code: string | null; city: string | null; legacy_id: string | null;
    customer_id: string | null; customer_name: string | null; customer_number: string | null; billing_street: string | null;
    billing_postal_code: string | null; billing_city: string | null; status: "draft" | "excluded"; excluded_reason: string | null;
    water_m3: string; wastewater_m3: string; net_eur: string; vat_eur: string; gross_eur: string;
    usage: { meterId: string; connectionKind: string; from: { readOn: string; reading: number } | null; to: { readOn: string; reading: number } | null; m3: number }[];
    issues: string[]; info: string | null; period_start: string; period_end: string; run_status: "draft" | "approved";
  }>(
    `select i.id, i.run_id, i.property_id, p.street_address, p.postal_code, p.city, p.legacy_id, i.customer_id, c.name as customer_name,
            c.customer_number, c.billing_street, c.billing_postal_code, c.billing_city, i.status, i.excluded_reason,
            i.water_m3::text, i.wastewater_m3::text, i.net_eur::text, i.vat_eur::text, i.gross_eur::text, i.usage, i.issues, i.info,
            r.period_start::text, r.period_end::text, r.status as run_status
       from ml_invoices i
       join ml_billing_runs r on r.id = i.run_id
       join ml_properties p on p.id = i.property_id
       left join ml_customers c on c.id = i.customer_id
      where i.organization_id = $1 and i.id = $2`,
    [orgId, id],
  );
  if (!invoice) return null;
  const lines = await tx.query<{ line_no: number; description: string; quantity: string; unit: "m3" | "month"; unit_price: string; vat_percent: string; net_eur: string }>(
    "select line_no, description, quantity::text, unit, unit_price::text, vat_percent::text, net_eur::text from ml_invoice_lines where invoice_id = $1 order by line_no",
    [id],
  );
  const meters = await tx.query<{ id: string; meter_number: string | null; multiplier: string }>(
    "select m.id, m.meter_number, m.multiplier::text from ml_meters m join ml_connections k on k.id = m.connection_id where k.property_id = $1",
    [invoice.property_id],
  );
  return { invoice, lines, meters };
}
