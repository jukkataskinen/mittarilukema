import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { normalizePhone } from "../src/lib/validation/phone.ts";

/**
 * Asiakkaiden tuonti CSV-tiedostosta paikalliseen kantaan tai `--tuotanto`-valinnalla Supabaseen.
 *
 *   npm run tuo:asiakkaat -- <tiedosto.csv> --org "Organisaation nimi" [--luo] [--kuiva] [--tuotanto]
 *
 * Sarakkeet (puolipiste, UTF-8): Nimi;Osoite;Postinumero;Postitoimipaikka;Email;Puhelin.
 * Osoite on laskutusosoite. Kiinteistöt ja sopimukset tuodaan myöhemmin
 * mittarilukema.fi:n varmuuskopiosta (BLOCKERS 1), koska tiedostossa ei ole
 * asiakasnumeroa eikä kiinteistötietoa.
 *
 * Tiedosto luetaan paikaltaan eikä sitä kopioida repoon. Tuloste näyttää vain
 * määrät, ei henkilötietoja. Uudelleenajo ei tuo samaa asiakasta kahdesti
 * (sama nimi, osoite ja postinumero).
 */

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--org");
const orgName = args[args.indexOf("--org") + 1];
const dryRun = args.includes("--kuiva");
if (!file || !args.includes("--org") || !orgName) {
  console.log('Käyttö: npm run tuo:asiakkaat -- <tiedosto.csv> --org "Organisaation nimi" [--kuiva]');
  process.exit(1);
}

const COMPANY = /\b(oy|oyj|ab|ky|ay|tmi|ry|rs|kunta|seurakunta|osakaskunta|yhtymä|kuolinpesä|oy:n|säätiö|osuuskunta)\b/i;

function parseCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(";").map((c) => c.trim().replace(/^"(.*)"$/, "$1")));
}

const rows = parseCsv(await readFile(file, "utf8"));
const header = rows.shift() ?? [];
const expected = ["Nimi", "Osoite", "Postinumero", "Postitoimipaikka", "Email", "Puhelin"];
if (expected.some((h, i) => header[i] !== h)) {
  console.log(`Odottamattomat sarakkeet. Odotettiin: ${expected.join(";")}`);
  process.exit(1);
}

const db = await openTargetDb(args);
const stats = { rows: rows.length, imported: 0, duplicates: 0, companies: 0, phones: 0, badPhones: 0, badPostal: 0, emails: 0 };

try {
  await db.asService(async (tx) => {
    let [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org && args.includes("--luo")) {
      // Paikallinen kokeilu: uusi organisaatio, jonka pääkäyttäjiksi tulevat muiden organisaatioiden pääkäyttäjät.
      [org] = await tx.query<{ id: string }>("insert into ml_organizations (name) values ($1) returning id", [orgName]);
      await tx.query(
        "insert into ml_org_members (organization_id, user_id, role) select distinct $1::uuid, user_id, 'owner' from ml_org_members where role = 'owner'",
        [org.id],
      );
      console.log(`Organisaatio "${orgName}" luotu.`);
    }
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy paikallisesta kannasta. Lisää --luo, jos haluat luoda sen.`);

    for (const [name, street, postal, city, email, phoneRaw] of rows) {
      if (!name) continue;
      const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
      if (phoneRaw && !phone) stats.badPhones++;
      if (phone) stats.phones++;
      const postalOk = /^\d{5}$/.test(postal ?? "");
      if (postal && !postalOk) stats.badPostal++;
      const kind = COMPANY.test(name) ? "company" : "person";
      if (kind === "company") stats.companies++;
      const mail = email?.includes("@") ? email.toLowerCase() : null;
      if (mail) stats.emails++;

      const dup = await tx.query(
        `select 1 from ml_customers where organization_id = $1 and lower(name) = lower($2)
            and coalesce(billing_street, '') = coalesce($3, '') and coalesce(billing_postal_code, '') = coalesce($4, '')`,
        [org.id, name, street || null, postalOk ? postal : null],
      );
      if (dup.length) {
        stats.duplicates++;
        continue;
      }
      await tx.query(
        `insert into ml_customers (organization_id, kind, name, email, phone, billing_street, billing_postal_code, billing_city, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [org.id, kind, name, mail, phone, street || null, postalOk ? postal : null, city || null, phoneRaw && !phone ? `Puhelin tuonnissa: ${phoneRaw}` : null],
      );
      stats.imported++;
    }
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) throw err;
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}

console.log(`Rivejä ${stats.rows}, tuotu ${stats.imported}, jo kannassa ${stats.duplicates}.`);
console.log(`Yrityksiä tai yhteisöjä ${stats.companies}, puhelinnumero ${stats.phones}, sähköposti ${stats.emails}.`);
if (stats.badPhones) console.log(`Tulkitsemattomia puhelinnumeroita ${stats.badPhones} (kirjattu muistiinpanoon).`);
if (stats.badPostal) console.log(`Virheellisiä postinumeroita ${stats.badPostal} (jätetty tyhjäksi).`);
