import type { Sql } from "@/lib/db/types";

/**
 * Hyväksytyn laskutusajon poisto huoltotoimena (0018). Ajetaan palveluroolilla:
 * lukitusfunktio sallii poiston vain lipun ml.allow_approved_delete kanssa,
 * eikä lippu vaikuta sovelluksen käyttäjärooliin. Lippu on voimassa vain tämän
 * transaktion (set_config ..., true).
 */
export async function deleteApprovedRun(tx: Sql, input: { runId: string; reason: string }) {
  const [run] = await tx.query<{ id: string; organization_id: string; org: string; status: string; period_start: string; period_end: string; approved_by: string | null }>(
    `select r.id, r.organization_id, o.name as org, r.status, r.period_start::text, r.period_end::text, r.approved_by
       from ml_billing_runs r join ml_organizations o on o.id = r.organization_id where r.id = $1`,
    [input.runId],
  );
  if (!run) throw new Error("Ajoa ei löytynyt.");
  if (run.status !== "approved") throw new Error("Ajo ei ole hyväksytty. Luonnoksen voi poistaa sovelluksesta.");
  const [counts] = await tx.query<{ invoices: number; lines: number; exports: number }>(
    `select (select count(*) from ml_invoices where run_id = $1)::int as invoices,
            (select count(*) from ml_invoice_lines l join ml_invoices i on i.id = l.invoice_id where i.run_id = $1)::int as lines,
            (select count(*) from ml_fennoa_exports where run_id = $1)::int as exports`,
    [run.id],
  );
  await tx.query("select set_config('ml.allow_approved_delete', 'on', true)");
  await tx.query("delete from ml_billing_runs where id = $1", [run.id]);
  await tx.query("select set_config('ml.allow_approved_delete', '', true)");
  await tx.query(
    "insert into ml_audit_log (organization_id, user_id, action, entity, entity_id, details) values ($1, $2, 'billing_run.delete_approved', 'ml_billing_runs', $3, $4)",
    [run.organization_id, run.approved_by, run.id, JSON.stringify({ ...counts, periodStart: run.period_start, periodEnd: run.period_end, reason: input.reason })],
  );
  return { org: run.org, periodStart: run.period_start, periodEnd: run.period_end, ...counts };
}
