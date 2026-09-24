import { openLocalDb } from "./lib/local-db.mts";

/**
 * Kuvitteellinen demodata paikalliseen kantaan: kaksi laitosta, käyttäjät
 * kaikille rooleille, kiinteistöt, mittarit, lukemat ja hinnasto. Kaikki
 * nimet, osoitteet, numerot ja hinnat ovat keksittyjä.
 *
 *   npm run db:seed:demo
 */

const db = await openLocalDb();

const existing = await db.asService((tx) => tx.query("select 1 from ml_organizations limit 1"));
if (existing.length) {
  console.log("Kannassa on jo organisaatioita. Aja ensin npm run db:reset, jos haluat aloittaa alusta.");
  await db.close();
  process.exit(0);
}

const FIRST = ["Aino", "Eero", "Helmi", "Juhani", "Kaarina", "Lauri", "Maija", "Niilo", "Oona", "Pekka", "Riitta", "Sulo", "Tuula", "Veikko"];
const LAST = ["Esimerkki", "Kuvitelma", "Malli", "Testinen", "Demola", "Harjoitus", "Kokeilu"];
const STREETS = ["Järvitie", "Harjukatu", "Koivukuja", "Rantapolku", "Myllytie", "Kirkkotie", "Pellonreuna"];

let seq = 0;
const pick = <T,>(arr: T[]) => arr[seq++ % arr.length];

await db.asService(async (tx) => {
  const user = async (email: string, name: string) =>
    (await tx.query<{ id: string }>("insert into ml_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [`dev|${email}`, email, name]))[0].id;
  const pääkäyttäjä = await user("paakayttaja@example.test", "Pää Käyttäjä");
  const toimisto = await user("toimisto@example.test", "Toimisto Testinen");
  const lukija = await user("lukija@example.test", "Lukija Demola");
  const toimistoB = await user("osuuskunta@example.test", "Osuuskunnan Sihteeri");

  const org = async (name: string, method: "actual" | "estimate") =>
    (
      await tx.query<{ id: string }>(
        "insert into ml_organizations (name, billing_method, billing_months, settlement_month) values ($1, $2, $3, $4) returning id",
        [name, method, method === "actual" ? [3, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], method === "estimate" ? 3 : null],
      )
    )[0].id;
  const orgA = await org("Demovesi Oy", "actual");
  const orgB = await org("Kuvitelman vesiosuuskunta", "estimate");
  await tx.query(
    `insert into ml_org_members (organization_id, user_id, role) values
       ($1, $3, 'owner'), ($1, $4, 'staff'), ($1, $5, 'reader'), ($2, $3, 'owner'), ($2, $6, 'staff')`,
    [orgA, orgB, pääkäyttäjä, toimisto, lukija, toimistoB],
  );

  for (const [orgId, areaNames, count, city, postal] of [
    [orgA, ["Keskusta", "Järvenranta", "Kylät"], 24, "Demola", "99990"],
    [orgB, ["Osuuskunta"], 8, "Kuvitelma", "99980"],
  ] as const) {
    const areas: string[] = [];
    for (const a of areaNames) {
      areas.push((await tx.query<{ id: string }>("insert into ml_areas (organization_id, name) values ($1, $2) returning id", [orgId, a]))[0].id);
    }
    for (let i = 0; i < count; i++) {
      const street = `${STREETS[i % STREETS.length]} ${1 + ((i * 3) % 40)}`;
      const [{ id: property }] = await tx.query<{ id: string }>(
        "insert into ml_properties (organization_id, area_id, street_address, postal_code, city) values ($1, $2, $3, $4, $5) returning id",
        [orgId, areas[i % areas.length], street, postal, city],
      );
      const [{ id: water }] = await tx.query<{ id: string }>(
        "insert into ml_connections (organization_id, property_id, kind, connected_on, fee_class) values ($1, $2, 'water', '2005-06-01', 'okt') returning id",
        [orgId, property],
      );
      if (i % 4 !== 3) {
        await tx.query("insert into ml_connections (organization_id, property_id, kind, connected_on, fee_class) values ($1, $2, 'wastewater', '2008-06-01', 'okt')", [
          orgId,
          property,
        ]);
      }
      const remote = i % 3 === 0;
      const [{ id: meter }] = await tx.query<{ id: string }>(
        `insert into ml_meters (organization_id, connection_id, meter_number, read_method, installed_on, start_reading)
         values ($1, $2, $3, $4, '2019-05-15', $5) returning id`,
        [orgId, water, `DM${String(100000 + i * 37).padStart(7, "0")}`, remote ? "remote" : "mechanical", 50 + i * 3],
      );
      // Lukemat puolen vuoden välein; kulutus 20–70 m³ jaksossa.
      let reading = 50 + i * 3;
      const perPeriod = 20 + ((i * 7) % 50);
      for (const readOn of ["2024-08-31", "2025-02-28", "2025-08-31", "2026-02-28", "2026-08-31"]) {
        reading += perPeriod + ((i + readOn.length) % 5);
        await tx.query(
          "insert into ml_readings (organization_id, meter_id, read_on, reading, source, status) values ($1, $2, $3, $4, $5, 'accepted')",
          [orgId, meter, readOn, reading, remote ? "remote" : i % 2 ? "sms" : "reader"],
        );
      }
      if (i === 2 || i === 5) {
        await tx.query(
          "insert into ml_readings (organization_id, meter_id, read_on, reading, source, status, issues, entered_by) values ($1, $2, '2026-09-20', $3, 'reader', 'needs_review', $4, $5)",
          [orgId, meter, i === 2 ? reading - 12 : reading + 420, i === 2 ? ["lower"] : ["large"], lukija],
        );
      }
      if (i % 6 !== 5) {
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const [{ id: customer }] = await tx.query<{ id: string }>(
          `insert into ml_customers (organization_id, customer_number, name, phone, billing_street, billing_postal_code, billing_city)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [orgId, String(1000 + i), name, `+35850000${String(1000 + i).slice(-4)}`, street, postal, city],
        );
        await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2012-01-01')", [
          orgId,
          property,
          customer,
        ]);
      }
    }
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Käyttömaksu, vesi', 'm3', 1.90, '2024-01-01'),
         ($1, 'usage_fee', 'wastewater', null, 'Käyttömaksu, jätevesi', 'm3', 3.10, '2024-01-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Perusmaksu, vesi', 'month', 9.50, '2024-01-01'),
         ($1, 'basic_fee', 'wastewater', 'okt', 'Perusmaksu, jätevesi', 'month', 12.00, '2024-01-01')`,
      [orgId],
    );
    await tx.query(
      "insert into ml_reading_rounds (organization_id, name, target_date, due_date) values ($1, 'Syksy 2026', '2026-08-31', '2026-09-30')",
      [orgId],
    );
  }
  await tx.query(
    "insert into ml_tariffs (organization_id, charge_type, name, unit, price_eur, vat_percent, valid_from) values ($1, 'loan_share', 'Lainaosuus', 'year', 120, 0, '2026-01-01'), ($1, 'extra_basic_fee', 'Lisäperusmaksu', 'month', 5, 25.5, '2026-01-01')",
    [orgB],
  );
});

console.log("Demodata luotu: Demovesi Oy (24 kiinteistöä) ja Kuvitelman vesiosuuskunta (8 kiinteistöä).");
console.log("Käyttäjät: Pää Käyttäjä (pääkäyttäjä), Toimisto Testinen, Lukija Demola, Osuuskunnan Sihteeri.");
await db.close();
