import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { resolveUser } from "@/lib/auth/resolve-user";
import { freshDb } from "../helpers/db";

let db: Database;

beforeAll(async () => {
  db = await freshDb();
  await db.asService((tx) =>
    tx.query("insert into ml_users (auth_sub, email, full_name) values ('pending|paa@example.test', 'Paa@Example.test', 'Pää Käyttäjä')"),
  );
});
afterAll(async () => {
  await db.close();
});

describe("käyttäjän tunnistus kirjautuessa", () => {
  it("varmennettu sähköposti yhdistetään esilisättyyn käyttäjään", async () => {
    const user = await db.asService((tx) => resolveUser(tx, { sub: "auth0|abc", email: "paa@example.test", emailVerified: true }));
    expect(user?.full_name).toBe("Pää Käyttäjä");
    const [row] = await db.asService((tx) => tx.query<{ auth_sub: string }>("select auth_sub from ml_users where id = $1", [user!.id]));
    expect(row.auth_sub).toBe("auth0|abc");
  });

  it("seuraavalla kerralla käyttäjä löytyy tunnisteella", async () => {
    const user = await db.asService((tx) => resolveUser(tx, { sub: "auth0|abc", email: null, emailVerified: false }));
    expect(user?.full_name).toBe("Pää Käyttäjä");
  });

  it("varmentamatonta osoitetta ei yhdistetä olemassa olevaan käyttäjään", async () => {
    const user = await db.asService((tx) => resolveUser(tx, { sub: "auth0|hyokkaaja", email: "paa@example.test", emailVerified: false }));
    expect(user).toBeNull();
  });

  it("uusi osoite luo käyttäjän ilman oikeuksia", async () => {
    const user = await db.asService((tx) => resolveUser(tx, { sub: "auth0|uusi", email: "uusi@example.test", emailVerified: true }));
    expect(user?.email).toBe("uusi@example.test");
    const members = await db.asService((tx) => tx.query("select 1 from ml_org_members where user_id = $1", [user!.id]));
    expect(members).toHaveLength(0);
  });
});
