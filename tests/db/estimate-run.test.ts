import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { approveBillingRun, createBillingRun } from "@/lib/billing/run";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Osuuskunta");
  await db.asService(async (tx) => {
    await tx.query("update ml_organizations set billing_method = 'estimate', settlement_month = 9 where id = $1", [a.id]);
    await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 1.5, '2024-01-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Perusmaksu', 'month', 5, '2024-01-01')`,
      [a.id],
    );
    // Aloituslukema 100 (2020); vuoden takainen 1000 ja nyt 1120 → vuosikulutus 120 m³.
    await tx.query(
      "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 1000, 'import'), ($1, $2, '2026-09-30', 1120, 'import')",
      [a.id, a.meter],
    );
  });
});
afterAll(async () => {
  await db.close();
});

describe("arviolaskutus ja tasaus", () => {
  it("kuukauden arviolasku edellisen vuoden kulutuksesta", async () => {
    const r = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2026-09-30", periodEnd: "2026-10-31", kind: "estimate" }),
    );
    const [inv] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ water_m3: string; net_eur: string; estimate_annual_m3: string; estimate_source: string; info: string }>(
        "select water_m3::text, net_eur::text, estimate_annual_m3::text, estimate_source, info from ml_invoices where run_id = $1",
        [r.runId],
      ),
    );
    expect(inv).toMatchObject({ water_m3: "10.000", net_eur: "20.00", estimate_annual_m3: "120.000", estimate_source: "history" });
    expect(inv.info).toMatch(/^Arviolasku 1\.10\.2026 - 31\.10\.2026: arvioitu vuosikulutus 120 m3 \(edellisen vuoden kulutus\)/);
    await db.asUser(a.owner.sub, (tx) => approveBillingRun(tx, { organizationId: a.id, userId: a.owner.id, runId: r.runId }));
  });

  it("tasaus vähentää hyväksytyillä arviolaskuilla laskutetun", async () => {
    await db.asService((tx) =>
      tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-10-31', 1135, 'staff')", [a.id, a.meter]),
    );
    const r = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2026-09-30", periodEnd: "2026-10-31", kind: "settlement" }),
    );
    const [inv] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ water_m3: string; net_eur: string; issues: string[]; info: string }>("select water_m3::text, net_eur::text, issues, info from ml_invoices where run_id = $1", [r.runId]),
    );
    // Toteutunut 15 m³, arviolla laskutettu 10 m³ → 15 × 1,50 € − 15,00 € = 7,50 €.
    expect(inv).toMatchObject({ water_m3: "15.000", net_eur: "7.50", issues: [] });
    expect(inv.info).toMatch(/^Tasaus 1\.10\.2026 - 31\.10\.2026: toteutunut 15 m3, arviolaskuilla laskutettu 10 m3\./);
  });

  it("arviolasku ja toteutuneen laskun ajo samalle jaksolle ovat eri ajoja", async () => {
    const r = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2026-09-30", periodEnd: "2026-10-31", kind: "actual" }),
    );
    expect(r.invoices).toBe(1);
  });
});
