import { createPgliteDatabase } from "../src/lib/db/pglite.ts";
import { migrateLocal } from "../src/lib/db/migrate.ts";
import { createPostgresDatabase } from "../src/lib/db/postgres.ts";
import { databaseUrl } from "../src/lib/config/deploy-env.ts";
import path from "node:path";

/**
 * Käyttäjän lisäys organisaatioon ennen ensimmäistä kirjautumista.
 *
 *   npm run kayttaja:lisaa -- --email etunimi.sukunimi@adepta.fi --nimi "Etunimi Sukunimi" \
 *     --org "Joutsan Vesihuolto Oy" --rooli owner [--luo-org actual|estimate] [--tuotanto]
 *
 * Käyttäjä luodaan tunnisteella `pending|<sähköposti>`. Ensimmäisellä
 * Auth0-kirjautumisella tunniste vaihtuu oikeaan, kun Auth0 on varmentanut
 * saman osoitteen (src/lib/auth/resolve-user.ts).
 *
 * Oletuksena paikallinen kanta. `--tuotanto` käyttää `.env.local`:n
 * DATABASE_URL-osoitetta eli Supabasea.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const email = arg("--email")?.trim().toLowerCase();
const fullName = arg("--nimi");
const orgName = arg("--org");
const role = arg("--rooli") ?? "owner";
const createOrg = arg("--luo-org");
const production = args.includes("--tuotanto");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !orgName || !["owner", "staff", "reader"].includes(role)) {
  console.log('Käyttö: npm run kayttaja:lisaa -- --email x@y.fi --nimi "Nimi" --org "Organisaatio" --rooli owner|staff|reader [--luo-org actual|estimate] [--tuotanto]');
  process.exit(1);
}
if (createOrg && !["actual", "estimate"].includes(createOrg)) {
  console.log("--luo-org saa arvon actual (toteutunut kulutus) tai estimate (arviolasku ja tasaus).");
  process.exit(1);
}

let db;
if (production) {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL puuttuu .env.local-tiedostosta.");
  db = createPostgresDatabase(url);
  console.log(`Kohde: tuotantokanta (${new URL(url).hostname})`);
} else {
  db = await createPgliteDatabase(path.join(process.cwd(), ".data", "pglite"));
  await migrateLocal(db);
  console.log("Kohde: paikallinen kanta");
}

try {
  await db.asService(async (tx) => {
    let [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) {
      if (!createOrg) throw new Error(`Organisaatiota "${orgName}" ei ole. Lisää --luo-org actual tai --luo-org estimate.`);
      [org] = await tx.query<{ id: string }>(
        "insert into ml_organizations (name, billing_method, billing_months, settlement_month) values ($1, $2, $3, $4) returning id",
        [orgName, createOrg, createOrg === "actual" ? [3, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], createOrg === "estimate" ? 3 : null],
      );
      console.log(`Organisaatio luotu: ${orgName} (${createOrg === "actual" ? "toteutunut kulutus" : "arviolasku ja tasaus"}).`);
    }
    let [user] = await tx.query<{ id: string }>("select id from ml_users where lower(email) = $1", [email]);
    if (!user) {
      [user] = await tx.query<{ id: string }>("insert into ml_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [
        `pending|${email}`,
        email,
        fullName ?? null,
      ]);
      console.log("Käyttäjä luotu. Tunniste päivittyy ensimmäisellä kirjautumisella.");
    } else if (fullName) {
      await tx.query("update ml_users set full_name = $2 where id = $1", [user.id, fullName]);
    }
    await tx.query(
      `insert into ml_org_members (organization_id, user_id, role) values ($1, $2, $3)
       on conflict (organization_id, user_id) do update set role = excluded.role`,
      [org.id, user.id, role],
    );
    await tx.query(
      "insert into ml_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'member.set', 'ml_org_members', $2, $3)",
      [org.id, user.id, JSON.stringify({ role, via: "kayttaja:lisaa" })],
    );
    console.log(`Rooli ${role} organisaatiossa ${orgName}.`);
  });
} finally {
  await db.close();
}
