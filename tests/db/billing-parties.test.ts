import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createBillingRun, deleteDraftRun } from "@/lib/billing/run";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Liittymissopimus ja käyttösopimus (DECISIONS 26.9.2026): saman jakson rivit
 * jaetaan omistajalle, vuokralaiselle ja lainan velalliselle.
 */

let db: Database;
let a: OrgFixture;
let tenant = "";
let buyer = "";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  [tenant, buyer] = await db.asService(async (tx) => {
    await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 2, '2024-09-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Veden perusmaksu', 'month', 10, '2024-09-01')`,
      [a.id],
    );
    await tx.query(
      "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 1000, 'import'), ($1, $2, '2026-03-31', 1050, 'import')",
      [a.id, a.meter],
    );
    await tx.query(
      "insert into ml_property_loans (organization_id, property_id, balance_eur, balance_date, monthly_amortization_eur, interest_percent) values ($1, $2, 1000, '2025-09-30', 50, 0)",
      [a.id, a.property],
    );
    const [t] = await tx.query<{ id: string }>("insert into ml_customers (organization_id, name) values ($1, 'Vuokralainen') returning id", [a.id]);
    const [b] = await tx.query<{ id: string }>("insert into ml_customers (organization_id, name) values ($1, 'Ostaja') returning id", [a.id]);
    // Omistaja on vuokrannut talon koko jakson: vuokralainen maksaa kulutuksen.
    await tx.query(
      "insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on, tenant_components) values ($1, $2, $3, 'tenant', '2025-01-01', '{usage}')",
      [a.id, a.property, t.id],
    );
    return [t.id, b.id];
  });
});
afterAll(async () => {
  await db.close();
});

const lines = (runId: string) =>
  db.asUser(a.staff.sub, (tx) =>
    tx.query<{ customer_id: string; kind: string; description: string; net: string }>(
      `select i.customer_id, l.kind, l.description, l.net_eur::text as net from ml_invoice_lines l join ml_invoices i on i.id = l.invoice_id
        where i.run_id = $1 order by i.customer_id, l.line_no`,
      [runId],
    ),
  );
const drop = (runId: string) => db.asUser(a.staff.sub, (tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.staff.id, runId }));

describe("liittymis- ja käyttösopimus", () => {
  it("vuokralainen maksaa kulutuksen, omistaja perusmaksun ja lainaosuuden", async () => {
    const r = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
    );
    expect(r.invoices).toBe(2);
    const inv = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ customer_id: string; water_m3: string; gross_eur: string; issues: string[] }>(
        "select customer_id, water_m3::text, gross_eur::text, issues from ml_invoices where run_id = $1",
        [r.runId],
      ),
    );
    const t = inv.find((i) => i.customer_id === tenant)!;
    const o = inv.find((i) => i.customer_id === a.customer)!;
    expect(t.water_m3).toBe("50.000");
    expect(o.water_m3).toBe("0.000");
    const ls = await lines(r.runId);
    expect(ls.filter((l) => l.customer_id === tenant).map((l) => l.kind)).toEqual(["usage"]);
    expect(ls.filter((l) => l.customer_id === a.customer).map((l) => l.description)).toEqual(["Veden perusmaksu", "Pääoman lyhennys"]);
    await drop(r.runId);
  });

  it("myyty talo: laina jää myyjälle, kunnes kauppakirja osoittaa siirron", async () => {
    await db.asService(async (tx) => {
      await tx.query("update ml_contracts set ends_on = '2026-01-15' where property_id = $1 and role = 'owner'", [a.property]);
      await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2026-01-16')", [
        a.id, a.property, buyer,
      ]);
      await tx.query("update ml_property_loans set debtor_customer_id = $2 where property_id = $1", [a.property, a.customer]);
    });
    // Arviolasku helmikuulle: ostaja maksaa perusmaksun, myyjä lainaosuuden.
    const r = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2026-01-31", periodEnd: "2026-02-28", kind: "estimate" }),
    );
    const ls = await lines(r.runId);
    expect(ls.filter((l) => l.customer_id === buyer).map((l) => l.description)).toEqual(["Veden perusmaksu"]);
    expect(ls.filter((l) => l.customer_id === a.customer).map((l) => l.description)).toEqual(["Pääoman lyhennys"]);
    const [debtorInv] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ info: string }>("select info from ml_invoices where run_id = $1 and customer_id = $2", [r.runId, a.customer]),
    );
    expect(debtorInv.info).toMatch(/Lainaosuus/);
    await drop(r.runId);
  });

  it("arviolasku seuraa kuukauden ensimmäistä päivää: vaihtokuukausi kuuluu myyjälle", async () => {
    await db.asService((tx) => tx.query("update ml_property_loans set debtor_customer_id = null where property_id = $1", [a.property]));
    const r = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-12-31", periodEnd: "2026-01-31", kind: "estimate" }),
    );
    const ls = await lines(r.runId);
    expect(new Set(ls.filter((l) => l.kind !== "usage").map((l) => l.customer_id))).toEqual(new Set([a.customer]));
    await drop(r.runId);
  });
});
