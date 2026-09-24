import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createRoundLinks, resolveLink, submitLinkReading } from "@/lib/readings/links";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
let roundA = "";
let token = "";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  roundA = await db.asService(async (tx) => {
    await tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-03-31', 150, 'staff')", [a.id, a.meter]);
    const [r] = await tx.query<{ id: string }>(
      "insert into ml_reading_rounds (organization_id, name, target_date, due_date) values ($1, 'Syksy', '2026-09-01', $2) returning id",
      [a.id, future],
    );
    return r.id;
  });
});
afterAll(async () => {
  await db.close();
});

describe("lukemalinkit", () => {
  it("toimisto luo linkit kierroksen mittareille; kantaan tallentuu vain tiiviste", async () => {
    const links = await db.asUser(a.staff.sub, (tx) => createRoundLinks(tx, { organizationId: a.id, userId: a.staff.id, roundId: roundA }));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ meterNumber: "M-1", customerName: "Testi Asiakas", phone: "+358401234567" });
    token = links[0].token;
    const stored = await db.asService((tx) => tx.query<{ token_hash: string }>("select token_hash from ml_reading_links"));
    expect(stored[0].token_hash).not.toContain(token);
  });

  it("mittarinlukija ja toinen organisaatio eivät voi luoda linkkejä", async () => {
    await expect(db.asUser(a.reader.sub, (tx) => createRoundLinks(tx, { organizationId: a.id, userId: a.reader.id, roundId: roundA }))).rejects.toThrow();
    await expect(db.asUser(b.owner.sub, (tx) => createRoundLinks(tx, { organizationId: a.id, userId: b.owner.id, roundId: roundA }))).rejects.toThrow();
  });

  it("linkki näyttää osoitteen ja edellisen lukeman, ei henkilötietoja", async () => {
    const view = await db.asService((tx) => resolveLink(tx, token));
    expect(view).toMatchObject({ streetAddress: "Testitie 1", meterNumber: "M-1", previous: { reading: 150, readOn: "2026-03-31" }, submitted: null });
    expect(JSON.stringify(view)).not.toMatch(/Testi Asiakas|358401234567/);
  });

  it("tuntematon tai muotoon sopimaton linkki ei paljasta mitään", async () => {
    expect(await db.asService((tx) => resolveLink(tx, "x".repeat(32)))).toBeNull();
    expect(await db.asService((tx) => resolveLink(tx, "' or 1=1 --"))).toBeNull();
  });

  it("lukeman ilmoitus ja korjaus samalla linkillä", async () => {
    const first = await submitLinkReading(db, token, { reading: "1500", readOn: "2026-09-02" });
    expect(first.issues).toEqual(["large"]);
    const second = await submitLinkReading(db, token, { reading: "165,5", readOn: "2026-09-02" });
    expect(second.issues).toEqual([]);
    const rows = await db.asService((tx) =>
      tx.query<{ reading: string; status: string; source: string }>("select reading::text, status, source from ml_readings where meter_id = $1 and read_on = '2026-09-02' order by created_at", [a.meter]),
    );
    expect(rows.map((r) => [r.reading, r.status, r.source])).toEqual([
      ["1500.000", "rejected", "form"],
      ["165.500", "accepted", "form"],
    ]);
    const view = await db.asService((tx) => resolveLink(tx, token));
    expect(view?.submitted).toEqual({ reading: 165.5, readOn: "2026-09-02" });
  });

  it("uudelleenluonti korvaa vanhan linkin", async () => {
    await db.asUser(a.staff.sub, (tx) => createRoundLinks(tx, { organizationId: a.id, userId: a.staff.id, roundId: roundA }));
    expect(await db.asService((tx) => resolveLink(tx, token))).toBeNull();
  });

  it("suljetun kierroksen linkki ei ole voimassa", async () => {
    const [fresh] = await db.asUser(a.staff.sub, (tx) => createRoundLinks(tx, { organizationId: a.id, userId: a.staff.id, roundId: roundA }));
    await db.asService((tx) => tx.query("update ml_reading_rounds set status = 'closed' where id = $1", [roundA]));
    expect(await db.asService((tx) => resolveLink(tx, fresh.token))).toBeNull();
    await expect(submitLinkReading(db, fresh.token, { reading: "190", readOn: "2026-09-03" })).rejects.toThrow(/ei ole enää voimassa/);
  });
});
