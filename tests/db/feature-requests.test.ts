import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Kehitystoiveet (0025): kaikki jäsenet jättävät, pääkäyttäjä ja toimisto käsittelevät. */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
});
afterAll(async () => {
  await db.close();
});

const insert = (user: OrgFixture["reader"], orgId: string, createdBy: string) =>
  db.asUser(user.sub, (tx) =>
    tx.query<{ id: string }>(
      "insert into ml_feature_requests (organization_id, created_by, feature, title, description) values ($1, $2, 'lukemat', 'Toive', 'Kuvaus') returning id",
      [orgId, createdBy],
    ),
  );

describe("kehitystoiveet", () => {
  it("mittarinlukija jättää toiveen omissa nimissään, mutta ei toisen nimissä eikä toiseen organisaatioon", async () => {
    const [row] = await insert(a.reader, a.id, a.reader.id);
    expect(row.id).toBeTruthy();
    await expect(insert(a.reader, a.id, a.staff.id)).rejects.toThrow();
    await expect(insert(a.reader, b.id, a.reader.id)).rejects.toThrow();
  });

  it("tilaa muuttaa toimisto, ei mittarinlukija", async () => {
    const byReader = await db.asUser(a.reader.sub, (tx) => tx.query("update ml_feature_requests set status = 'done' returning id", []));
    expect(byReader).toHaveLength(0);
    const byStaff = await db.asUser(a.staff.sub, (tx) => tx.query("update ml_feature_requests set status = 'planned' returning id", []));
    expect(byStaff).toHaveLength(1);
  });

  it("toinen organisaatio ei näe toiveita", async () => {
    expect(await db.asUser(b.staff.sub, (tx) => tx.query("select 1 from ml_feature_requests", []))).toHaveLength(0);
  });
});
