import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createBillingRun } from "@/lib/billing/run";
import { applySwapBatch, createSwapBatch, recheckSwapBatch } from "@/lib/meters/campaign";
import { MeterSwapError, swapMeter } from "@/lib/meters/swap";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Mittarinvaihto ja vaihtokampanja (0022). */

let db: Database;
let a: OrgFixture;
const TODAY = "2026-09-26";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  await db.asService(async (tx) => {
    await tx.query("update ml_properties set legacy_id = '10' where id = $1", [a.property]);
    await tx.query("insert into ml_tariffs (organization_id, charge_type, connection_kind, name, unit, price_eur, valid_from) values ($1, 'usage_fee', 'water', 'Vesi', 'm3', 2, '2024-01-01')", [a.id]);
    await tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-03-31', 500, 'import')", [a.id, a.meter]);
  });
});
afterAll(async () => {
  await db.close();
});

const asStaff = <T,>(fn: Parameters<typeof db.asUser<T>>[1]) => db.asUser(a.staff.sub, fn);

describe("mittarinvaihto", () => {
  it("loppulukema ei voi olla edellistä pienempi", async () => {
    await expect(
      asStaff((tx) =>
        swapMeter(tx, {
          organizationId: a.id, userId: a.staff.id, oldMeterId: a.meter, today: TODAY, date: "2026-06-15", finalReading: 400, newMeterNumber: "WM1",
          startReading: 0, readMethod: "remote", source: "staff",
        }),
      ),
    ).rejects.toThrow(MeterSwapError);
  });
});

describe("vaihtokampanja", () => {
  let batchId = "";
  it("lataus tarkistaa rivit kirjaamatta mitään", async () => {
    const r = await asStaff((tx) =>
      createSwapBatch(tx, {
        organizationId: a.id, userId: a.staff.id, name: "Viikko 38", filename: null, today: TODAY,
        csv: "Vanha mittari;Vaihtopäivä;Loppulukema;Uusi mittari;Aloituslukema\nM-1;15.6.2026;530;WM1;0,5\nX-9;15.6.2026;10;WM2;0\n",
      }),
    );
    batchId = r.batchId;
    expect([r.ready, r.errors]).toEqual([1, 1]);
    const meters = await asStaff((tx) => tx.query("select 1 from ml_meters where removed_on is null", []));
    expect(meters).toHaveLength(1);
  });

  it("kirjaus vaihtaa mittarin ja tapahtuma syntyy", async () => {
    const r = await asStaff((tx) => applySwapBatch(tx, { organizationId: a.id, userId: a.staff.id, batchId, today: TODAY }));
    expect(r).toEqual({ applied: 1, failed: 0, remaining: 0 });
    const ms = await asStaff((tx) =>
      tx.query<{ meter_number: string; removed_on: string | null; final_reading: string | null; start_reading: string; read_method: string }>(
        "select meter_number, removed_on::text, final_reading::text, start_reading::text, read_method from ml_meters order by installed_on",
        [],
      ),
    );
    expect(ms.map((m) => [m.meter_number, m.removed_on, m.final_reading, m.start_reading, m.read_method])).toEqual([
      ["M-1", "2026-06-15", "530.000", "100.000", "mechanical"],
      ["WM1", null, null, "0.500", "remote"],
    ]);
    const [ev] = await asStaff((tx) => tx.query<{ kind: string }>("select kind from ml_property_events", []));
    expect(ev.kind).toBe("meter_change");
  });

  it("uudelleentarkistus ei kirjaa samaa vaihtoa kahdesti", async () => {
    const r = await asStaff((tx) => recheckSwapBatch(tx, { organizationId: a.id, batchId, today: TODAY }));
    expect(r.ready).toBe(0);
  });

  it("laskutus: vanhan kulutus loppulukemaan ja uuden aloituslukemasta", async () => {
    await db.asService((tx) =>
      tx.query(
        "insert into ml_readings (organization_id, meter_id, read_on, reading, source) select $1, id, '2026-09-30', 20.5, 'import' from ml_meters where meter_number = 'WM1'",
        [a.id],
      ),
    );
    const run = await asStaff((tx) => createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2026-03-31", periodEnd: "2026-09-30" }));
    const [inv] = await asStaff((tx) => tx.query<{ water_m3: string; issues: string[] }>("select water_m3::text, issues from ml_invoices where run_id = $1", [run.runId]));
    // 530 - 500 = 30 ja 20,5 - 0,5 = 20.
    expect(inv.water_m3).toBe("50.000");
  });
});
