import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { normalizePhone } from "../src/lib/validation/phone.ts";

/**
 * Kärkisen asiakastietojen täydennys asiakasrekisteristä, sidoksista ja
 * verkkolaskuosoitteista (scripts/karkinen/parse.py → data/private/karkinen).
 *
 *   npm run karkinen:taydenna -- [--org "Kärkisten vesiosuuskunta"] [--kuiva] [--tuotanto]
 *
 * Asiakas haetaan asiakasnumerolla (huoneiston tunnus). Täydennetään:
 *   - laskutusosoite henkilörekisteristä (korvaa aiemman)
 *   - sähköposti ja puhelin, jos asiakkaalla ei vielä ole niitä
 *   - verkkolaskuosoite ja välittäjä
 *   - sopimuksen alkupäivä ja lisätiedot (lisähenkilö, sidoksen lisätiedot)
 * Voidaan ajaa uudelleen: muistiinpanot muodostetaan joka kerta alusta.
 * Tuloste näyttää vain määrät.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const dryRun = args.includes("--kuiva");

type Person = { email: string | null; puhelin: string | null; katu: string | null; postinumero: string | null; toimipaikka: string | null; lisatiedot: string | null };
type Bond = { alku: string | null; loppu: string | null; lisahenkilo: string | null; lisatiedot: string | null };
type Unit = {
  tunnus: string;
  rekisteri?: { maksajan_sidos: Bond | null; henkilo: Person | null; verkkolasku: { osoite: string; valittaja: string; suoramaksu: boolean } | null };
};
const data = JSON.parse(await readFile("data/private/karkinen/karkinen.json", "utf8")) as { jakso: string; huoneistot: Unit[] };
const year = Number(data.jakso.slice(0, 4));
const month = Number(data.jakso.slice(4, 6));
const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

const stats = { units: 0, noCustomer: 0, address: 0, email: 0, phone: 0, einvoice: 0, startDate: 0, lateStart: 0, contractNotes: 0, customerNotes: 0 };
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy.`);
    for (const u of data.huoneistot) {
      const reg = u.rekisteri;
      if (!reg) throw new Error("Aineistosta puuttuvat rekisteritiedot: aja parse.py uudelleen asiakasrekisterin ja sidosten kanssa.");
      stats.units++;
      const [customer] = await tx.query<{ id: string; email: string | null; phone: string | null; notes: string | null }>(
        "select id, email, phone, notes from ml_customers where organization_id = $1 and customer_number = $2",
        [org.id, u.tunnus],
      );
      if (!customer) {
        stats.noCustomer++;
        continue;
      }
      const p = reg.henkilo;
      const e = reg.verkkolasku;
      const email = !customer.email && p?.email?.includes("@") ? p.email.toLowerCase() : customer.email;
      const phone = !customer.phone && p?.puhelin ? (normalizePhone(p.puhelin) ?? customer.phone) : customer.phone;
      const postalOk = /^\d{5}$/.test(p?.postinumero ?? "");
      // Tuonnin omat puhelinhuomautukset säilyvät, muu muodostetaan uudelleen.
      const keep = (customer.notes ?? "").split("\n").filter((l) => l.startsWith("Puhelin"));
      const notes = [...keep, e?.suoramaksu ? "Suoramaksu" : null, p?.lisatiedot ?? null].filter(Boolean).join("\n") || null;
      await tx.query(
        `update ml_customers set billing_street = coalesce($2, billing_street), billing_postal_code = coalesce($3, billing_postal_code),
                billing_city = coalesce($4, billing_city), email = $5, phone = $6, einvoice_address = $7, einvoice_operator = $8, notes = $9,
                updated_at = now()
          where id = $1`,
        [customer.id, p?.katu && postalOk ? p.katu : null, postalOk ? p!.postinumero : null, postalOk ? p!.toimipaikka : null, email, phone,
          e?.osoite ?? null, e?.valittaja ?? null, notes],
      );
      if (p?.katu && postalOk) stats.address++;
      if (email && email !== customer.email) stats.email++;
      if (phone && phone !== customer.phone) stats.phone++;
      if (e) stats.einvoice++;
      if (notes && notes !== customer.notes) stats.customerNotes++;

      const b = reg.maksajan_sidos;
      const start = b?.alku && b.alku <= periodEnd ? b.alku : null;
      if (b?.alku && !start) stats.lateStart++;
      const contractNotes = [b?.lisahenkilo ? `Lisähenkilö: ${b.lisahenkilo}` : null, b?.lisatiedot ?? null].filter(Boolean).join("\n") || null;
      await tx.query(
        `update ml_contracts set starts_on = coalesce($3::date, starts_on), notes = $4
          where organization_id = $1 and customer_id = $2 and billed and ends_on is null`,
        [org.id, customer.id, start, contractNotes],
      );
      if (start) stats.startDate++;
      if (contractNotes) stats.contractNotes++;
    }
    await tx.query("insert into ml_audit_log (organization_id, action, entity, details) values ($1, 'import.karkinen_registry', 'ml_customers', $2)", [
      org.id, JSON.stringify(stats),
    ]);
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) {
    // Vain virheviesti: kannan virheolio sisältää kyselyn parametrit eli henkilötietoja.
    console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
    await db.close();
    process.exit(1);
  }
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}

console.log(`Huoneistoja ${stats.units}, asiakasta ei löytynyt ${stats.noCustomer}.`);
console.log(`Laskutusosoite ${stats.address}, uusi sähköposti ${stats.email}, uusi puhelin ${stats.phone}, verkkolaskuosoite ${stats.einvoice}.`);
console.log(`Sopimuksen alkupäivä ${stats.startDate} (jakson jälkeen alkavia ohitettu ${stats.lateStart}), sopimuksen lisätiedot ${stats.contractNotes}, asiakkaan lisätiedot ${stats.customerNotes}.`);
