import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createBillingRun } from "@/lib/billing/run";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Tuoterekisteri laskutusajossa (0024): tuote, tili ja laskentakohde riveille. */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  await db.asService(async (tx) => {
    await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 0.95, '2024-09-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Veden perusmaksu', 'month', 3.67, '2024-09-01')`,
      [a.id],
    );
    await tx.query(
      "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 1000, 'import'), ($1, $2, '2026-03-31', 1050, 'import')",
      [a.id, a.meter],
    );
    const [acc] = await tx.query<{ id: string }>("insert into ml_accounts (organization_id, code) values ($1, '3020') returning id", [a.id]);
    const [acc2] = await tx.query<{ id: string }>("insert into ml_accounts (organization_id, code) values ($1, '3024') returning id", [a.id]);
    const [cc] = await tx.query<{ id: string }>("insert into ml_cost_centers (organization_id, code, name) values ($1, '1', 'Puhdasvesi') returning id", [a.id]);
    await tx.query(
      `insert into ml_products (organization_id, code, name, account_id, cost_center_id, auto_match, match_charge_type, match_connection_kind, match_fee_class, match_customer_group)
       values ($1, '1000', 'Veden perusmaksu Joutsa', $2, $4, true, 'basic_fee', 'water', 'okt', null),
              ($1, '1110', 'Veden perusmaksu kunta', $3, $4, true, 'basic_fee', 'water', 'okt', 'kunta')`,
      [a.id, acc.id, acc2.id, cc.id],
    );
  });
});
afterAll(async () => {
  await db.close();
});

const runLines = async () => {
  const r = await db.asUser(a.staff.sub, (tx) =>
    createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
  );
  const lines = await db.asUser(a.staff.sub, (tx) =>
    tx.query<{ kind: string; product_code: string | null; account_code: string | null; cost_center_code: string | null }>(
      `select l.kind, l.product_code, l.account_code, l.cost_center_code from ml_invoice_lines l join ml_invoices i on i.id = l.invoice_id
        where i.run_id = $1 order by l.line_no`,
      [r.runId],
    ),
  );
  const [inv] = await db.asUser(a.staff.sub, (tx) => tx.query<{ issues: string[] }>("select issues from ml_invoices where run_id = $1", [r.runId]));
  await db.asUser(a.staff.sub, (tx) => tx.query("delete from ml_billing_runs where id = $1", [r.runId]));
  return { lines, issues: inv.issues };
};

describe("tuotteet laskutusajossa", () => {
  it("perusmaksulle tuote, tili ja laskentakohde; kulutusriville huomautus puuttuvasta tuotteesta", async () => {
    const { lines, issues } = await runLines();
    expect(lines).toEqual([
      { kind: "usage", product_code: null, account_code: null, cost_center_code: null },
      { kind: "basic_fee", product_code: "1000", account_code: "3020", cost_center_code: "1" },
    ]);
    expect(issues.join()).toMatch(/Riville ei löytynyt tuotetta \(Vesi\)/);
  });

  it("asiakasryhmä kunta valitsee kunnan tuotteen", async () => {
    await db.asService((tx) => tx.query("update ml_customers set customer_group = 'kunta' where id = $1", [a.customer]));
    const { lines } = await runLines();
    expect(lines.find((l) => l.kind === "basic_fee")).toMatchObject({ product_code: "1110", account_code: "3024" });
  });
});
