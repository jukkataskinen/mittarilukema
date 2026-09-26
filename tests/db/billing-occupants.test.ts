import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createBillingRun, deleteDraftRun } from "@/lib/billing/run";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Mittarittoman kiinteistön kulutus henkilöluvun tai sovitun vuosikulutuksen mukaan (0026, kehitystoive 26.9.2026). */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  await db.asService(async (tx) => {
    // Pelkkä jätevesiliittymä ilman mittaria, kuten Rutalahden mittarittomat.
    await tx.query("delete from ml_meters where organization_id = $1", [a.id]);
    await tx.query("update ml_connections set kind = 'wastewater', fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'wastewater', null, 'Jätevesi', 'm3', 2.92, '2024-09-01'),
         ($1, 'basic_fee', 'wastewater', 'okt', 'Jäteveden perusmaksu', 'month', 18.46, '2024-09-01')`,
      [a.id],
    );
  });
});
afterAll(async () => {
  await db.close();
});

const run = async () => {
  const r = await db.asUser(a.staff.sub, (tx) =>
    createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2026-03-31", periodEnd: "2026-09-30" }),
  );
  const [inv] = await db.asUser(a.staff.sub, (tx) =>
    tx.query<{ wastewater_m3: string; issues: string[]; info: string | null }>("select wastewater_m3::text, issues, info from ml_invoices where run_id = $1", [r.runId]),
  );
  const lines = await db.asUser(a.staff.sub, (tx) =>
    tx.query<{ description: string; quantity: string }>(
      "select l.description, l.quantity::text from ml_invoice_lines l join ml_invoices i on i.id = l.invoice_id where i.run_id = $1 order by l.line_no",
      [r.runId],
    ),
  );
  await db.asUser(a.staff.sub, (tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.staff.id, runId: r.runId }));
  return { inv, lines };
};

describe("mittariton kiinteistö", () => {
  it("ilman henkilölukua: vain perusmaksu ja huomautus", async () => {
    const { inv, lines } = await run();
    expect(lines.map((l) => l.description)).toEqual(["Jätevesi perusmaksu"]);
    expect(inv.issues.join()).toMatch(/Anna henkilöluku tai sovittu vuosikulutus/);
  });

  it("henkilöluku 1: 40 m³ vuodessa, puolelta vuodelta 20 m³", async () => {
    await db.asService((tx) => tx.query("update ml_properties set occupants = 1 where id = $1", [a.property]));
    const { inv, lines } = await run();
    expect(lines).toEqual([
      { description: "Jätevesi, sovittu kulutus", quantity: "20.000" },
      { description: "Jätevesi perusmaksu", quantity: "6.000" },
    ]);
    expect(inv.wastewater_m3).toBe("20.000");
    expect(inv.issues).toEqual([]);
    expect(inv.info).toMatch(/henkilöluvun mukaan: 1 × 40 m3 vuodessa/);
  });

  it("sovittu vuosikulutus ohittaa henkilöluvun, ja kerroin on asetus", async () => {
    await db.asService((tx) => tx.query("update ml_properties set estimated_annual_m3 = 60 where id = $1", [a.property]));
    expect((await run()).lines[0]).toEqual({ description: "Jätevesi, sovittu kulutus", quantity: "30.000" });
    await db.asService(async (tx) => {
      await tx.query("update ml_properties set estimated_annual_m3 = null, occupants = 2 where id = $1", [a.property]);
      await tx.query("update ml_organizations set occupant_m3_per_year = 50 where id = $1", [a.id]);
    });
    expect((await run()).lines[0]).toEqual({ description: "Jätevesi, sovittu kulutus", quantity: "50.000" });
  });
});
