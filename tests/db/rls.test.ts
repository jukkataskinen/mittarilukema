import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Organisaatioiden eristys: vesihuoltolaitos näkee vain omat asiakkaansa,
 * kiinteistönsä ja lukemansa. Tämä on koko sovelluksen tärkein testi
 * (DECISIONS 24.9.2026, oma Supabase-projekti).
 */

const TABLES = [
  "ml_organizations",
  "ml_org_members",
  "ml_areas",
  "ml_properties",
  "ml_connections",
  "ml_meters",
  "ml_customers",
  "ml_contracts",
  "ml_reading_rounds",
  "ml_readings",
  "ml_tariffs",
  "ml_property_charges",
  "ml_property_loans",
  "ml_legacy_billed_estimates",
  "ml_property_events",
];
// Laskutusajon taulut testataan tiedostossa billing-run.test.ts.

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  await db.asService(async (tx) => {
    for (const org of [a, b]) {
      await tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-02-28', 150, 'staff')", [
        org.id,
        org.meter,
      ]);
      await tx.query(
        "insert into ml_reading_rounds (organization_id, name, target_date, due_date) values ($1, 'Kevät 2026', '2026-02-28', '2026-03-10')",
        [org.id],
      );
      await tx.query(
        "insert into ml_tariffs (organization_id, charge_type, connection_kind, name, unit, price_eur, valid_from) values ($1, 'usage_fee', 'water', 'Käyttömaksu, vesi', 'm3', 1.95, '2026-01-01')",
        [org.id],
      );
      await tx.query(
        "insert into ml_property_charges (organization_id, property_id, name, unit, price_eur, valid_from) values ($1, $2, 'Lisäperusmaksu', 'month', 39, '2026-01-01')",
        [org.id, org.property],
      );
      await tx.query(
        "insert into ml_property_loans (organization_id, property_id, balance_eur, balance_date, monthly_amortization_eur) values ($1, $2, 1000, '2026-08-31', 50)",
        [org.id, org.property],
      );
      await tx.query(
        "insert into ml_legacy_billed_estimates (organization_id, property_id, month, connection_kind, m3, net_eur, gross_eur, source) values ($1, $2, '2026-01-01', 'water', 2, 4.1, 5.14, 'invoice')",
        [org.id, org.property],
      );
      await tx.query("insert into ml_property_events (organization_id, property_id, kind, event_date) values ($1, $2, 'meter_change', '2026-05-01')", [
        org.id,
        org.property,
      ]);
    }
  });
});

afterAll(async () => {
  await db.close();
});

describe("organisaatioiden eristys", () => {
  for (const table of TABLES) {
    it(`${table}: käyttäjä näkee vain oman organisaationsa rivit`, async () => {
      const col = table === "ml_organizations" ? "id" : "organization_id";
      const rows = await db.asUser(a.staff.sub, (tx) => tx.query<{ org: string }>(`select ${col} as org from ${table}`));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.org === a.id)).toBe(true);
    });
  }

  it("toisen organisaation riviä ei voi muuttaa", async () => {
    const updated = await db.asUser(a.owner.sub, (tx) =>
      tx.query("update ml_customers set name = 'Muutettu' where id = $1 returning id", [b.customer]),
    );
    expect(updated).toHaveLength(0);
  });

  it("omaan organisaatioon ei voi lisätä riviä, joka viittaa toisen organisaation mittariin", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        tx.query("insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2026-03-01', 160, 'staff')", [
          a.id,
          b.meter,
        ]),
      ),
    ).rejects.toThrow(/toisen organisaation/);
  });

  it("kiinteistön maksu ei voi viitata toisen organisaation kiinteistöön", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        tx.query("insert into ml_property_charges (organization_id, property_id, name, unit, price_eur, valid_from) values ($1, $2, 'X', 'once', 1, '2026-01-01')", [
          a.id,
          b.property,
        ]),
      ),
    ).rejects.toThrow(/toisen organisaation/);
  });

  it("toiseen organisaatioon ei voi lisätä rivejä", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => tx.query("insert into ml_areas (organization_id, name) values ($1, 'Vieras')", [b.id])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("roolit", () => {
  it("mittarinlukija voi kirjata lukeman omissa nimissään", async () => {
    const rows = await db.asUser(a.reader.sub, (tx) =>
      tx.query(
        "insert into ml_readings (organization_id, meter_id, read_on, reading, source, entered_by) values ($1, $2, '2026-03-02', 170, 'reader', $3) returning id",
        [a.id, a.meter, a.reader.id],
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it("mittarinlukija ei voi hyväksyä lukemaa eikä muokata rekisteriä", async () => {
    const updated = await db.asUser(a.reader.sub, (tx) =>
      tx.query("update ml_readings set status = 'accepted', reviewed_by = $2 where organization_id = $1 returning id", [a.id, a.reader.id]),
    );
    expect(updated).toHaveLength(0);
    await expect(
      db.asUser(a.reader.sub, (tx) => tx.query("insert into ml_areas (organization_id, name) values ($1, 'Uusi')", [a.id])),
    ).rejects.toThrow();
  });

  it("mittarinlukija ei voi kirjata lukemaa toisen käyttäjän nimissä", async () => {
    await expect(
      db.asUser(a.reader.sub, (tx) =>
        tx.query(
          "insert into ml_readings (organization_id, meter_id, read_on, reading, source, entered_by) values ($1, $2, '2026-03-03', 171, 'reader', $3)",
          [a.id, a.meter, a.staff.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("vain pääkäyttäjä voi muuttaa organisaation asetuksia", async () => {
    const byStaff = await db.asUser(a.staff.sub, (tx) =>
      tx.query("update ml_organizations set billing_method = 'estimate' where id = $1 returning id", [a.id]),
    );
    expect(byStaff).toHaveLength(0);
    const byOwner = await db.asUser(a.owner.sub, (tx) =>
      tx.query("update ml_organizations set billing_method = 'estimate' where id = $1 returning id", [a.id]),
    );
    expect(byOwner).toHaveLength(1);
  });
});

describe("tietomallin säännöt", () => {
  it("kiinteistöllä on kerrallaan yksi laskutettava liittymissopimus ja yksi käyttösopimus", async () => {
    await expect(
      db.asService((tx) =>
        tx.query(
          "insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2026-01-01')",
          [a.id, a.property, a.customer],
        ),
      ),
    ).rejects.toThrow(/ml_contracts_one_billed/);
    // Käyttösopimus omistajan rinnalle käy, mutta toista päällekkäistä ei.
    await expect(
      db.asService(async (tx) => {
        await tx.query(
          "insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'tenant', '2026-01-01'), ($1, $2, $3, 'tenant', '2026-06-01')",
          [a.id, a.property, a.customer],
        );
      }),
    ).rejects.toThrow(/ml_contracts_one_billed/);
    await db.asService((tx) =>
      tx.query(
        "insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on, ends_on) values ($1, $2, $3, 'tenant', '2026-01-01', '2026-01-31')",
        [a.id, a.property, a.customer],
      ),
    );
  });

  it("päättynyt sopimus ja uusi sopimus voivat olla peräkkäin", async () => {
    await db.asService(async (tx) => {
      await tx.query("update ml_contracts set ends_on = '2025-12-31' where property_id = $1", [b.property]);
      await tx.query(
        "insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'tenant', '2026-01-01')",
        [b.id, b.property, b.customer],
      );
    });
  });

  it("kiinteistöllä on yksi voimassa oleva vesiliittymä", async () => {
    await expect(
      db.asService((tx) =>
        tx.query("insert into ml_connections (organization_id, property_id, kind, connected_on) values ($1, $2, 'water', '2020-01-01')", [a.id, a.property]),
      ),
    ).rejects.toThrow(/ml_connections_active/);
  });

  it("asiakkaan puhelinnumero on kansainvälisessä muodossa", async () => {
    await expect(
      db.asService((tx) => tx.query("insert into ml_customers (organization_id, name, phone) values ($1, 'X', '040 123 4567')", [a.id])),
    ).rejects.toThrow(/ml_customers_phone_check/);
  });

  it("päällekkäisiä hintoja ei voi olla", async () => {
    await expect(
      db.asService((tx) =>
        tx.query(
          "insert into ml_tariffs (organization_id, charge_type, connection_kind, name, unit, price_eur, valid_from) values ($1, 'usage_fee', 'water', 'Käyttömaksu, vesi', 'm3', 2.10, '2026-06-01')",
          [a.id],
        ),
      ),
    ).rejects.toThrow(/ml_tariffs_no_overlap/);
  });
});
