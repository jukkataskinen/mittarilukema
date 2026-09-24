import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { recordBulkReadings, roundSheet } from "@/lib/readings/bulk";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let roundId = "";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  roundId = await db.asService(async (tx) => {
    await tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-03-31', 150, 'import')", [a.id, a.meter]);
    const [r] = await tx.query<{ id: string }>(
      "insert into ml_reading_rounds (organization_id, name, target_date, due_date) values ($1, 'Syksy', '2026-09-30', '2026-10-15') returning id",
      [a.id],
    );
    return r.id;
  });
});
afterAll(async () => {
  await db.close();
});

describe("kierroksen lukulista", () => {
  it("näyttää edellisen lukeman ja puuttuvan kierroksen lukeman", async () => {
    const rows = await db.asUser(a.reader.sub, (tx) => roundSheet(tx, { organizationId: a.id, roundId, targetDate: "2026-09-30" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meter_number: "M-1", previous_reading: "150.000", round_reading: null });
  });

  it("mittarinlukija kirjaa useita lukemia; virheellinen rivi ei estä muita", async () => {
    const res = await db.asUser(a.reader.sub, (tx) =>
      recordBulkReadings(tx, {
        organizationId: a.id, userId: a.reader.id, roundId, readOn: "2026-09-29", source: "reader",
        entries: [
          { meterId: a.meter, value: "171,5" },
          { meterId: a.meter, value: "ei luku" },
        ],
      }),
    );
    expect(res).toMatchObject({ saved: 1, errors: [{ message: "Lukema ei ole luku." }] });
    const rows = await db.asUser(a.reader.sub, (tx) => roundSheet(tx, { organizationId: a.id, roundId, targetDate: "2026-09-30" }));
    expect(rows[0]).toMatchObject({ round_reading: "171.500", round_read_on: "2026-09-29" });
  });

  it("mittarinlukija ei korvaa saman päivän lukemaa; toimisto korvaa", async () => {
    const byReader = await db.asUser(a.reader.sub, (tx) =>
      recordBulkReadings(tx, { organizationId: a.id, userId: a.reader.id, roundId, readOn: "2026-09-29", source: "reader", entries: [{ meterId: a.meter, value: "172" }] }),
    );
    expect(byReader.errors[0].message).toMatch(/jo lukema/);
    const byStaff = await db.asUser(a.staff.sub, (tx) =>
      recordBulkReadings(tx, { organizationId: a.id, userId: a.staff.id, roundId, readOn: "2026-09-29", source: "staff", entries: [{ meterId: a.meter, value: "172" }] }),
    );
    expect(byStaff.saved).toBe(1);
  });
});
