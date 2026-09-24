import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { handleInboundSms } from "@/lib/sms/inbound";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
const NUMBER_A = "+358501110001";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  await db.asService(async (tx) => {
    await tx.query("update ml_organizations set sms_number = $2 where id = $1", [a.id, NUMBER_A]);
    await tx.query("update ml_properties set legacy_id = '40960' where id = $1", [a.property]);
    await tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-03-31', 150, 'import')", [a.id, a.meter]);
  });
});
afterAll(async () => {
  await db.close();
});

describe("tekstiviestilukemat", () => {
  it("tunnettu asiakas, yksi mittari: lukema kirjataan ja vastaus muodostetaan", async () => {
    const res = await handleInboundSms(db, { from: "040 123 4567", to: NUMBER_A, body: "Lukema 165", receivedAt: "2026-09-25T08:00:00Z", providerMessageId: "p1" });
    expect(res.status).toBe("recorded");
    expect(res.reply).toBe("Kiitos! Lukema 165 m3 vastaanotettu (Testitie 1).");
    const [r] = await db.asService((tx) => tx.query<{ reading: string; source: string; read_on: string }>("select reading::text, source, read_on::text from ml_readings where source = 'sms'"));
    expect(r).toEqual({ reading: "165.000", source: "sms", read_on: "2026-09-25" });
  });

  it("sama palveluntarjoajan viesti käsitellään vain kerran", async () => {
    const res = await handleInboundSms(db, { from: "0401234567", to: NUMBER_A, body: "Lukema 165", receivedAt: "2026-09-25T08:00:00Z", providerMessageId: "p1" });
    expect(res.status).toBe("duplicate");
  });

  it("tuntematon lähettäjä jää käsiteltäväksi", async () => {
    const res = await handleInboundSms(db, { from: "+358409999999", to: NUMBER_A, body: "1234" });
    expect(res.status).toBe("unmatched");
    const [row] = await db.asUser(a.staff.sub, (tx) => tx.query<{ reason: string }>("select reason from ml_inbound_sms where id = $1", [res.id]));
    expect(row.reason).toMatch(/ei ole asiakasrekisterissä/);
  });

  it("tuntematon vastaanottajanumero ei kuulu millekään organisaatiolle", async () => {
    const res = await handleInboundSms(db, { from: "0401234567", to: "+358500000000", body: "1234" });
    expect(res.status).toBe("unmatched");
    const seenA = await db.asUser(a.owner.sub, (tx) => tx.query("select 1 from ml_inbound_sms where id = $1", [res.id]));
    expect(seenA).toHaveLength(0);
  });

  it("useampi kiinteistö: käyttöpaikan tunnus ratkaisee", async () => {
    await db.asService(async (tx) => {
      const [p] = await tx.query<{ id: string }>("insert into ml_properties (organization_id, street_address, legacy_id) values ($1, 'Toinen 2', '40961') returning id", [a.id]);
      const [k] = await tx.query<{ id: string }>("insert into ml_connections (organization_id, property_id, kind, connected_on) values ($1, $2, 'water', '2010-01-01') returning id", [a.id, p.id]);
      await tx.query("insert into ml_meters (organization_id, connection_id, read_method, installed_on, start_reading) values ($1, $2, 'mechanical', '2020-01-01', 0)", [a.id, k.id]);
      await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2020-01-01')", [a.id, p.id, a.customer]);
    });
    const ambiguous = await handleInboundSms(db, { from: "0401234567", to: NUMBER_A, body: "170", receivedAt: "2026-09-26T08:00:00Z" });
    expect(ambiguous.status).toBe("unmatched");
    expect(ambiguous.reply).toMatch(/käyttöpaikan numero/);
    const ok = await handleInboundSms(db, { from: "0401234567", to: NUMBER_A, body: "40960 170", receivedAt: "2026-09-26T08:00:00Z" });
    expect(ok.status).toBe("recorded");
  });

  it("toisen organisaation toimisto ei näe viestejä", async () => {
    const rows = await db.asUser(b.owner.sub, (tx) => tx.query("select 1 from ml_inbound_sms"));
    expect(rows).toHaveLength(0);
    const own = await db.asUser(a.staff.sub, (tx) => tx.query("select 1 from ml_inbound_sms"));
    expect(own.length).toBeGreaterThan(0);
  });

  it("mittarinlukija ei näe tekstiviestejä", async () => {
    const rows = await db.asUser(a.reader.sub, (tx) => tx.query("select 1 from ml_inbound_sms"));
    expect(rows).toHaveLength(0);
  });
});
