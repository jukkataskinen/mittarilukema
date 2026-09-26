import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createBillingRun, deleteDraftRun } from "@/lib/billing/run";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let newCustomer = "";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  newCustomer = await db.asService(async (tx) => {
    await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 0.95, '2024-09-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Veden perusmaksu', 'month', 3.67, '2024-09-01')`,
      [a.id],
    );
    await tx.query(
      "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 5657, 'import'), ($1, $2, '2026-03-31', 5710, 'import')",
      [a.id, a.meter],
    );
    // Omistajanvaihdos 15.1.2026: vanha sopimus päättyy, uusi alkaa seuraavana päivänä.
    await tx.query("update ml_contracts set ends_on = '2026-01-15' where property_id = $1", [a.property]);
    const [c] = await tx.query<{ id: string }>("insert into ml_customers (organization_id, name) values ($1, 'Uusi Omistaja') returning id", [a.id]);
    await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2026-01-16')", [
      a.id,
      a.property,
      c.id,
    ]);
    return c.id;
  });
});
afterAll(async () => {
  await db.close();
});

const run = () =>
  db.asUser(a.staff.sub, (tx) => createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }));
const invoicesOf = (runId: string) =>
  db.asUser(a.staff.sub, (tx) =>
    tx.query<{ customer_id: string; period_start: string; period_end: string; water_m3: string; issues: string[]; info: string }>(
      "select customer_id, period_start::text, period_end::text, water_m3::text, issues, info from ml_invoices where run_id = $1 order by period_end",
      [runId],
    ),
  );

describe("loppulasku omistajanvaihdoksessa", () => {
  it("ilman vaihtopäivän lukemaa: yksi lasku uudelle maksajalle ja huomautus", async () => {
    const r = await run();
    const inv = await invoicesOf(r.runId);
    expect(inv).toHaveLength(1);
    expect(inv[0].customer_id).toBe(newCustomer);
    expect(inv[0].issues.join()).toMatch(/vaihtopäivältä ole lukemaa/);
    await db.asUser(a.staff.sub, (tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.staff.id, runId: r.runId }));
  });

  it("vaihtopäivän lukemalla: loppulasku edelliselle ja lasku uudelle maksajalle", async () => {
    await db.asService((tx) =>
      tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-01-15', 5680, 'staff')", [a.id, a.meter]),
    );
    const r = await run();
    const inv = await invoicesOf(r.runId);
    expect(inv.map((i) => [i.customer_id, i.period_start, i.period_end, i.water_m3, i.issues])).toEqual([
      [a.customer, "2025-09-30", "2026-01-15", "23.000", []],
      [newCustomer, "2026-01-15", "2026-03-31", "30.000", []],
    ]);
    expect(inv[0].info).toMatch(/^Laskutusjakso 1\.10\.2025 - 15\.1\.2026 \(osapuolten vaihdos\)\./);
    const fees = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ quantity: string }>(
        `select l.quantity::text from ml_invoice_lines l join ml_invoices i on i.id = l.invoice_id
          where i.run_id = $1 and l.kind = 'basic_fee' order by i.period_end`,
        [r.runId],
      ),
    );
    // Perusmaksu: loka–tammi edelliselle, helmi–maalis uudelle (yhteensä 6 kk).
    expect(fees.map((f) => f.quantity)).toEqual(["4.000", "2.000"]);
  });
});
