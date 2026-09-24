import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { approveBillingRun, createBillingRun, deleteDraftRun, setInvoiceExcluded } from "@/lib/billing/run";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  await db.asService(async (tx) => {
    for (const o of [a, b]) {
      await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [o.id]);
      await tx.query(
        "insert into ml_connections (organization_id, property_id, kind, connected_on, fee_class) values ($1, $2, 'wastewater', '2010-01-01', 'okt')",
        [o.id, o.property],
      );
      await tx.query(
        `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
           ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 0.95, '2024-09-01'),
           ($1, 'usage_fee', 'wastewater', null, 'Jätevesi', 'm3', 2.92, '2024-09-01'),
           ($1, 'basic_fee', 'water', 'okt', 'Veden perusmaksu', 'month', 3.67, '2024-09-01'),
           ($1, 'basic_fee', 'wastewater', 'okt', 'Jätevesi perusmaksu', 'month', 7.02, '2024-09-01')`,
        [o.id],
      );
      // Mittarin aloituslukema 100 (2020); lukemat 2025-09-30: 5657 → 2026-03-31: 5710.
      await tx.query(
        "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 5657, 'import'), ($1, $2, '2026-03-31', 5710, 'import')",
        [o.id, o.meter],
      );
    }
  });
});
afterAll(async () => {
  await db.close();
});

describe("laskutusajo", () => {
  let runId = "";

  it("laskee laskun ja rivit kiinteistölle", async () => {
    const res = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
    );
    runId = res.runId;
    expect(res.invoices).toBe(1);
    const [inv] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ net_eur: string; gross_eur: string; customer_id: string; issues: string[] }>("select net_eur::text, gross_eur::text, customer_id, issues from ml_invoices where run_id = $1", [runId]),
    );
    expect([inv.net_eur, inv.gross_eur, inv.customer_id, inv.issues]).toEqual(["269.25", "337.91", a.customer, []]);
    const lines = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ description: string }>("select description from ml_invoice_lines l join ml_invoices i on i.id = l.invoice_id where i.run_id = $1 order by line_no", [runId]),
    );
    expect(lines.map((l) => l.description)).toEqual(["Vesi", "Jätevesi", "Veden perusmaksu", "Jätevesi perusmaksu"]);
    const [{ info }] = await db.asUser(a.staff.sub, (tx) => tx.query<{ info: string }>("select info from ml_invoices where run_id = $1", [runId]));
    expect(info).toBe("Mittari M-1: edellinen lukema 5657 m3, 30.9.2025 - 31.3.2026: 5710 m3, Testitie 1");
  });

  it("samalle jaksolle ei synny toista ajoa", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" })),
    ).rejects.toThrow(/jo laskutusajo/);
  });

  it("aluerajaus: ajo ottaa vain rajauksen kiinteistöt", async () => {
    // Testikiinteistö kuuluu alueeseen, joten ilman aluetta -ajossa ei ole laskuja.
    const none = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31", scope: "no_area" }),
    );
    expect(none.invoices).toBe(0);
    const area = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31", scope: { areaId: a.area } }),
    );
    expect(area.invoices).toBe(1);
    for (const runId of [none.runId, area.runId]) {
      await db.asUser(a.staff.sub, (tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.staff.id, runId }));
    }
  });

  it("toinen organisaatio ei näe ajoa eikä laskuja", async () => {
    const runs = await db.asUser(b.owner.sub, (tx) => tx.query("select 1 from ml_billing_runs where id = $1", [runId]));
    const invs = await db.asUser(b.owner.sub, (tx) => tx.query("select 1 from ml_invoices where run_id = $1", [runId]));
    expect([runs.length, invs.length]).toEqual([0, 0]);
  });

  it("mittarinlukija ei voi luoda laskutusajoa", async () => {
    await expect(
      db.asUser(a.reader.sub, (tx) => createBillingRun(tx, { organizationId: a.id, userId: a.reader.id, periodStart: "2026-03-31", periodEnd: "2026-09-30" })),
    ).rejects.toThrow(/row-level security/);
  });

  it("laskun voi jättää pois luonnoksesta", async () => {
    const [inv] = await db.asUser(a.staff.sub, (tx) => tx.query<{ id: string }>("select id from ml_invoices where run_id = $1", [runId]));
    const ok = await db.asUser(a.staff.sub, (tx) =>
      setInvoiceExcluded(tx, { organizationId: a.id, userId: a.staff.id, invoiceId: inv.id, excluded: true, reason: "Loppulasku erikseen" }),
    );
    expect(ok).toBe(true);
  });

  it("hyväksytty ajo on lukittu", async () => {
    expect(await db.asUser(a.owner.sub, (tx) => approveBillingRun(tx, { organizationId: a.id, userId: a.owner.id, runId }))).toBe(true);
    await expect(db.asUser(a.owner.sub, (tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.owner.id, runId }))).resolves.toBe(false);
    await expect(
      db.asUser(a.owner.sub, (tx) => tx.query("update ml_invoices set net_eur = 0 where run_id = $1", [runId])),
    ).rejects.toThrow(/Hyväksytyn/);
    await expect(db.asService((tx) => tx.query("delete from ml_billing_runs where id = $1", [runId]))).rejects.toThrow(/Hyväksyttyä/);
  });

  it("luonnoksen voi poistaa ja laskea uudelleen", async () => {
    const r = await db.asUser(b.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: b.id, userId: b.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
    );
    expect(await db.asUser(b.staff.sub, (tx) => deleteDraftRun(tx, { organizationId: b.id, userId: b.staff.id, runId: r.runId }))).toBe(true);
    const again = await db.asUser(b.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: b.id, userId: b.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
    );
    expect(again.invoices).toBe(1);
  });
});
