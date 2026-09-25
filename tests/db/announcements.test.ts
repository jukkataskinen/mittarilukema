import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { findRecipients, lockAnnouncement, markLettersPrinted, sendEmailBatch } from "@/lib/announcements";
import { mockEmail } from "@/lib/email";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
let annId = "";
const today = "2026-09-25";
const runner = (sub: string) => <T,>(fn: Parameters<Database["asUser"]>[1]) => db.asUser(sub, fn) as Promise<T>;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  await db.asService(async (tx) => {
    // Kolme maksajaa: sähköposti, pelkkä postiosoite ja ei kumpaakaan. Lisäksi päättynyt sopimus.
    await tx.query("update ml_customers set email = 'eka@example.fi' where id = $1", [a.customer]);
    for (const [name, email, street] of [["Posti Asiakas", null, "Kirjetie 2"], ["Tuntematon Asiakas", null, null], ["Entinen Asiakas", "entinen@example.fi", "Vanhatie 3"]] as const) {
      const [p] = await tx.query<{ id: string }>("insert into ml_properties (organization_id, street_address) values ($1, $2) returning id", [a.id, `${name} kohde`]);
      const [c] = await tx.query<{ id: string }>(
        "insert into ml_customers (organization_id, name, email, billing_street, billing_postal_code, billing_city) values ($1, $2, $3, $4, $5, $6) returning id",
        [a.id, name, email, street, street ? "41800" : null, street ? "Korpilahti" : null],
      );
      await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on, ends_on) values ($1, $2, $3, 'owner', '2020-01-01', $4)", [
        a.id, p.id, c.id, name.startsWith("Entinen") ? "2026-01-31" : null,
      ]);
    }
    await tx.query("update ml_customers set billing_street = 'Testitie 1', billing_postal_code = '41800', billing_city = 'Korpilahti' where id = $1", [a.customer]);
  });
});
afterAll(async () => {
  await db.close();
});

describe("tiedotteet", () => {
  it("vastaanottajat voimassa olevista sopimuksista ja toimitustapa säännöstä", async () => {
    const r = await db.asUser(a.staff.sub, (tx) => findRecipients(tx, a.id, { audience: "payers", area_id: null, delivery: "email_first" }, today));
    expect(r.map((x) => x.channel).sort()).toEqual(["email", "letter", "none"]);
    expect(r.some((x) => x.name === "Entinen Asiakas")).toBe(false);
  });

  it("lukitus tallentaa vastaanottajat, ja luonnosta ei voi lukita kahdesti", async () => {
    annId = await db.asUser(a.staff.sub, async (tx) => {
      const [row] = await tx.query<{ id: string }>("insert into ml_announcements (organization_id, title, body) values ($1, 'Hinnat muuttuvat', 'Hyvä osakas.') returning id", [a.id]);
      return row.id;
    });
    const counts = await db.asUser(a.staff.sub, (tx) => lockAnnouncement(tx, { organizationId: a.id, userId: a.staff.id, announcementId: annId, today }));
    expect(counts).toEqual({ email: 1, letter: 1, none: 1 });
    await expect(db.asUser(a.staff.sub, (tx) => lockAnnouncement(tx, { organizationId: a.id, userId: a.staff.id, announcementId: annId, today }))).rejects.toThrow(/jo lukittu/);
  });

  it("sähköposti lähtee kerran, vastausosoitteena organisaation sähköposti", async () => {
    await db.asService((tx) => tx.query("update ml_organizations set contact_email = 'toimisto@example.fi' where id = $1", [a.id]));
    const sender = mockEmail();
    const s = await sendEmailBatch(runner(a.staff.sub), sender, { organizationId: a.id, userId: a.staff.id, announcementId: annId });
    expect(s).toMatchObject({ sent: 1, failed: 0, remaining: 0 });
    expect(sender.sent[0]).toMatchObject({ to: "eka@example.fi", subject: "Hinnat muuttuvat", replyTo: "toimisto@example.fi", fromName: "Laitos A" });
    const again = mockEmail();
    await sendEmailBatch(runner(a.staff.sub), again, { organizationId: a.id, userId: a.staff.id, announcementId: annId });
    expect(again.sent).toHaveLength(0);
  });

  it("kirjeet merkitään postitetuiksi, ja tiedote valmistuu kun kaikki on toimitettu", async () => {
    const n = await db.asUser(a.staff.sub, (tx) => markLettersPrinted(tx, { organizationId: a.id, userId: a.staff.id, announcementId: annId }));
    expect(n).toBe(1);
    const [row] = await db.asUser(a.staff.sub, (tx) => tx.query<{ status: string }>("select status from ml_announcements where id = $1", [annId]));
    expect(row.status).toBe("sent");
  });

  it("toinen organisaatio ei näe tiedotteita eikä vastaanottajia", async () => {
    const rows = await db.asUser(b.staff.sub, (tx) => tx.query("select 1 from ml_announcements union all select 1 from ml_announcement_recipients"));
    expect(rows).toHaveLength(0);
  });

  it("mittarinlukija ei voi luoda tiedotetta", async () => {
    await expect(
      db.asUser(a.reader.sub, (tx) => tx.query("insert into ml_announcements (organization_id, title, body) values ($1, 'x', 'y')", [a.id])),
    ).rejects.toThrow();
  });
});
