import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { recordReading, reviewReading } from "@/lib/readings/record";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
});
afterAll(async () => {
  await db.close();
});

describe("lukeman kirjaus", () => {
  it("ensimmäistä lukemaa verrataan aloituslukemaan", async () => {
    const res = await db.asUser(a.staff.sub, (tx) =>
      recordReading(tx, { organizationId: a.id, meterId: a.meter, readOn: "2026-02-28", reading: 90, source: "staff", userId: a.staff.id }),
    );
    expect(res.issues).toEqual(["lower"]);
    const [row] = await db.asUser(a.staff.sub, (tx) => tx.query<{ status: string }>("select status from ml_readings where id = $1", [res.id]));
    expect(row.status).toBe("needs_review");
  });

  it("toimiston korjaus samalle päivälle korvaa aiemman lukeman", async () => {
    const res = await db.asUser(a.staff.sub, (tx) =>
      recordReading(tx, { organizationId: a.id, meterId: a.meter, readOn: "2026-02-28", reading: 140, source: "staff", userId: a.staff.id }),
    );
    expect(res.issues).toEqual([]);
    const rows = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ status: string }>("select status from ml_readings where meter_id = $1 order by created_at", [a.meter]),
    );
    expect(rows.map((r) => r.status)).toEqual(["rejected", "accepted"]);
  });

  it("tarkistettava lukema hyväksytään ja kirjataan lokiin", async () => {
    const res = await db.asUser(a.reader.sub, (tx) =>
      recordReading(tx, { organizationId: a.id, meterId: a.meter, readOn: "2026-08-31", reading: 500, source: "reader", userId: a.reader.id }),
    );
    expect(res.issues).toEqual(["large"]);
    const ok = await db.asUser(a.staff.sub, (tx) =>
      reviewReading(tx, { organizationId: a.id, readingId: res.id, userId: a.staff.id, decision: "accepted" }),
    );
    expect(ok).toBe(true);
    const log = await db.asUser(a.owner.sub, (tx) => tx.query<{ action: string }>("select action from ml_audit_log order by id"));
    expect(log.map((l) => l.action)).toContain("reading.accept");
  });

  it("mittarinlukija ei voi hyväksyä lukemaa", async () => {
    const res = await db.asUser(a.reader.sub, (tx) =>
      recordReading(tx, { organizationId: a.id, meterId: a.meter, readOn: "2026-09-01", reading: 400, source: "reader", userId: a.reader.id }),
    );
    expect(res.issues).toEqual(["lower"]);
    const ok = await db.asUser(a.reader.sub, (tx) =>
      reviewReading(tx, { organizationId: a.id, readingId: res.id, userId: a.reader.id, decision: "accepted" }),
    );
    expect(ok).toBe(false);
  });
});
