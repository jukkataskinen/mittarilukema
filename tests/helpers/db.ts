import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import type { Database, Sql } from "@/lib/db/types";

/** Tuore muistikanta, johon on ajettu kaikki migraatiot. */
export async function freshDb(): Promise<Database> {
  const db = await createPgliteDatabase();
  await migrateLocal(db);
  return db;
}

export interface TestUser {
  id: string;
  sub: string;
}

export interface OrgFixture {
  id: string;
  owner: TestUser;
  staff: TestUser;
  reader: TestUser;
  area: string;
  property: string;
  connection: string;
  meter: string;
  customer: string;
}

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function one<T>(tx: Sql, text: string, params: unknown[] = []): Promise<T> {
  const rows = await tx.query<T>(text, params);
  if (rows.length !== 1) throw new Error(`odotettiin 1 rivi, saatiin ${rows.length}: ${text}`);
  return rows[0];
}

export async function createUser(db: Database, email?: string): Promise<TestUser> {
  const sub = `test|${uniq()}`;
  const row = await db.asService((tx) =>
    one<{ id: string }>(tx, "insert into ml_users (auth_sub, email) values ($1, $2) returning id", [
      sub,
      email ?? `${sub.replace("|", "-")}@example.test`,
    ]),
  );
  return { id: row.id, sub };
}

/** Organisaatio, jossa on kaikki roolit ja yksi kiinteistö liittymineen, mittareineen ja asiakkaineen. */
export async function seedOrg(db: Database, name: string): Promise<OrgFixture> {
  const owner = await createUser(db);
  const staff = await createUser(db);
  const reader = await createUser(db);
  return db.asService(async (tx) => {
    const id = (await one<{ id: string }>(tx, "insert into ml_organizations (name) values ($1) returning id", [name])).id;
    await tx.query(
      "insert into ml_org_members (organization_id, user_id, role) values ($1,$2,'owner'),($1,$3,'staff'),($1,$4,'reader')",
      [id, owner.id, staff.id, reader.id],
    );
    const area = (await one<{ id: string }>(tx, "insert into ml_areas (organization_id, name) values ($1, 'Keskusta') returning id", [id])).id;
    const property = (
      await one<{ id: string }>(
        tx,
        "insert into ml_properties (organization_id, area_id, street_address, postal_code, city) values ($1, $2, 'Testitie 1', '19650', 'Joutsa') returning id",
        [id, area],
      )
    ).id;
    const connection = (
      await one<{ id: string }>(
        tx,
        "insert into ml_connections (organization_id, property_id, kind, connected_on) values ($1, $2, 'water', '2010-01-01') returning id",
        [id, property],
      )
    ).id;
    const meter = (
      await one<{ id: string }>(
        tx,
        "insert into ml_meters (organization_id, connection_id, meter_number, read_method, installed_on, start_reading) values ($1, $2, 'M-1', 'mechanical', '2020-01-01', 100) returning id",
        [id, connection],
      )
    ).id;
    const customer = (
      await one<{ id: string }>(tx, "insert into ml_customers (organization_id, name, phone) values ($1, 'Testi Asiakas', '+358401234567') returning id", [id])
    ).id;
    await tx.query(
      "insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2015-01-01')",
      [id, property, customer],
    );
    return { id, owner, staff, reader, area, property, connection, meter, customer };
  });
}
