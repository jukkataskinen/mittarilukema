import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { buildMeterChains, matchCustomer, titleCaseAddress, type CustomerCandidate, type RawReading } from "../src/lib/import/fennoa.ts";

/**
 * Fennoan myyntilaskuaineiston tuonti paikalliseen kantaan tai `--tuotanto`-valinnalla Supabaseen.
 *
 *   python scripts/fennoa/parse_invoices.py <fennoa_export.zip>
 *   npm run tuo:laskut -- --org "Joutsan Vesihuolto Oy" [data/private/fennoa/invoices.json] [--kuiva] [--tuotanto]
 *
 * - Asiakas: laskun asiakas yhdistetään asiakasluetteloon (nimi ja osoite,
 *   sumea vertailu saman postinumeron sisällä) ja saa laskun asiakasnumeron.
 *   Asiakas, jota ei löydy, luodaan laskun tiedoista ja merkitään muistiinpanoon.
 * - Kiinteistö: yksi jokaista käyttöpaikkaa (Unes) kohden, tunnus `legacy_id`:ksi.
 * - Liittymät laskurivien tuotteista, mittarit ja mittarinvaihdot lukemaketjusta.
 * - Sopimus: laskun asiakas on kiinteistön maksaja laskutusjakson alusta.
 *   Omistaja/vuokralainen ei selviä laskulta, joten rooliksi tulee omistaja.
 * - Lukemat, jotka eivät täsmää laskutettuun kulutukseen, jäävät tarkistettaviksi.
 *
 * Tuloste näyttää vain määriä. Aja kerran: skripti pysähtyy, jos
 * organisaatiolla on jo tuotuja kiinteistöjä.
 */

interface Row { tuote: string; lkm: number | null; hinta: number | null }
interface Reading {
  muoto: string; edellinen: number | null; uusi: number | null; jakso_alku?: string | null; jakso_loppu?: string | null;
  kerroin?: number; unes: string | null; kayttopaikka: string | null; sovittu_m3?: number | null;
}
interface Invoice {
  laskunro: string | null; asiakasnro: string | null; laskupvm: string | null; toimituspvm: string | null; tyyppi: string;
  tiedosto: string; laskutus: { nimi: string | null; katu: string | null; postinro: string | null; toimipaikka: string | null };
  rivit: Row[]; lukemat: Reading[]; tarkistus: string;
}

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--org") ?? "data/private/fennoa/invoices.json";
const dryRun = args.includes("--kuiva");
if (!orgName) {
  console.log('Käyttö: npm run tuo:laskut -- --org "Organisaation nimi" [invoices.json] [--kuiva]');
  process.exit(1);
}

const COMPANY = /\b(oy|oyj|ab|ky|ay|tmi|ry|kunta|seurakunta|osakaskunta|yhtymä|kuolinpesä|säätiö|osuuskunta)\b/i;
const AREA = /(Rutalahti|Leivonmäki|Joutsa)$/;
const WATER = /^(vesi|kylmävesi|veden|perusmaksu)/i;
const WASTE = /jäte/i;
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
const invDate = (i: Invoice) => i.toimituspvm ?? i.laskupvm ?? "2026-01-01";
const periodStart = (i: Invoice) => i.lukemat.map((r) => r.jakso_alku).filter((d): d is string => !!d).sort()[0] ?? invDate(i);
const fmt = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2 });

const all: Invoice[] = JSON.parse(await readFile(file, "utf8"));
const invoices = all
  .filter((i) => i.tyyppi === "Lasku")
  .sort((a, b) => (a.laskupvm ?? "").localeCompare(b.laskupvm ?? "") || Number(a.laskunro) - Number(b.laskunro));

const stats = {
  invoices: invoices.length, credits: all.length - invoices.length,
  matched: 0, created: 0, numbered: 0, properties: 0, connections: 0, meters: 0, meterChanges: 0,
  readings: 0, review: 0, replaced: 0, contracts: 0, noUnes: 0, areas: 0,
};
const how = new Map<string, number>();

const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy paikallisesta kannasta.`);
    const done = await tx.query("select 1 from ml_properties where organization_id = $1 and legacy_id is not null limit 1", [org.id]);
    if (done.length) throw new Error("Organisaatiolle on jo tuotu kiinteistöjä. Aja npm run db:reset ja tuo asiakkaat uudelleen, jos haluat aloittaa alusta.");

    // --- Asiakkaat ---
    const existing = await tx.query<{ id: string; name: string; billing_street: string | null; billing_postal_code: string | null; customer_number: string | null }>(
      "select id, name, billing_street, billing_postal_code, customer_number from ml_customers where organization_id = $1",
      [org.id],
    );
    const free: CustomerCandidate[] = existing
      .filter((c) => !c.customer_number)
      .map((c) => ({ id: c.id, name: c.name, street: c.billing_street, postalCode: c.billing_postal_code }));
    const byNumber = new Map(existing.filter((c) => c.customer_number).map((c) => [c.customer_number as string, c.id]));
    const customerKey = (i: Invoice) => i.asiakasnro ?? `nimi:${(i.laskutus.nimi ?? "").toLowerCase()}`;
    const latest = new Map<string, Invoice>();
    for (const i of invoices) if (i.laskutus.nimi) latest.set(customerKey(i), i);

    const customerOf = new Map<string, string>();
    for (const [key, i] of latest) {
      if (i.asiakasnro && byNumber.has(i.asiakasnro)) {
        customerOf.set(key, byNumber.get(i.asiakasnro)!);
        continue;
      }
      const b = i.laskutus;
      const m = matchCustomer({ name: b.nimi!, street: b.katu, postalCode: b.postinro }, free);
      if (m) {
        free.splice(free.findIndex((c) => c.id === m.id), 1);
        if (i.asiakasnro) {
          await tx.query("update ml_customers set customer_number = $2 where id = $1", [m.id, i.asiakasnro]);
          stats.numbered++;
        }
        customerOf.set(key, m.id);
        stats.matched++;
        how.set(m.how, (how.get(m.how) ?? 0) + 1);
      } else {
        const [row] = await tx.query<{ id: string }>(
          `insert into ml_customers (organization_id, customer_number, kind, name, billing_street, billing_postal_code, billing_city, notes)
           values ($1, $2, $3, $4, $5, $6, $7, 'Luotu Fennoan laskuaineistosta: asiakasta ei löytynyt asiakasluettelosta.') returning id`,
          [org.id, i.asiakasnro, COMPANY.test(b.nimi!) ? "company" : "person", b.nimi, b.katu, b.postinro, b.toimipaikka],
        );
        customerOf.set(key, row.id);
        stats.created++;
      }
    }

    // --- Alueet ---
    const areaIds = new Map<string, string>();
    const areaOf = async (name: string) => {
      if (!areaIds.has(name)) {
        const [row] = await tx.query<{ id: string }>(
          "insert into ml_areas (organization_id, name) values ($1, $2) on conflict (organization_id, name) do update set name = excluded.name returning id",
          [org.id, name],
        );
        areaIds.set(name, row.id);
        stats.areas++;
      }
      return areaIds.get(name)!;
    };

    // --- Käyttöpaikat ---
    const places = new Map<string, Invoice[]>();
    for (const i of invoices) {
      const ids = [...new Set(i.lukemat.map((r) => r.unes).filter((u): u is string => !!u))];
      if (i.lukemat.length && ids.length === 0) stats.noUnes++;
      for (const u of ids) places.set(u, [...(places.get(u) ?? []), i]);
    }

    for (const [unes, invs] of places) {
      // Käyttöpaikan perään on joskus kirjoitettu huomautus ("…, MITTARI VAIHDETTU 4.11.2025"): se muistiinpanoihin.
      const place = [...invs].reverse().flatMap((i) => i.lukemat.filter((r) => r.unes === unes && r.kayttopaikka).map((r) => r.kayttopaikka!))[0];
      const [address, ...remarks] = (place ?? "").split(/,\s*/);
      const rows = invs.flatMap((i) => i.rivit);
      const areaCounts = new Map<string, number>();
      for (const r of rows) {
        const a = r.tuote.match(AREA)?.[1];
        if (a) areaCounts.set(a, (areaCounts.get(a) ?? 0) + 1);
      }
      const area = [...areaCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
      const fees = (rx: RegExp, not?: RegExp) =>
        [...new Set(rows.filter((r) => /perusmaksu/i.test(r.tuote) && rx.test(r.tuote) && !(not && not.test(r.tuote)) && r.hinta !== null).map((r) => r.hinta!))];
      const waterFees = fees(/./, WASTE);
      const wasteFees = fees(WASTE);
      const agreed = invs.flatMap((i) => i.lukemat.filter((r) => r.unes === unes && r.muoto === "F" && r.sovittu_m3).map((r) => r.sovittu_m3!));
      const notes = [
        "Tuotu Fennoan myyntilaskuista 2026.",
        remarks.length ? `Laskun käyttöpaikkatieto: ${remarks.join(", ").toLowerCase()}` : null,
        waterFees.length ? `Veden perusmaksu laskuilla ${waterFees.map(fmt).join(" / ")} €/kk.` : null,
        wasteFees.length ? `Jäteveden perusmaksu laskuilla ${wasteFees.map(fmt).join(" / ")} €/kk.` : null,
        agreed.length ? `Ei vesimittaria, sovittu kulutus ${fmt(agreed.at(-1)!)} m³ laskutusjaksossa.` : null,
      ].filter(Boolean).join("\n");

      const [{ id: property }] = await tx.query<{ id: string }>(
        "insert into ml_properties (organization_id, area_id, street_address, notes, legacy_id) values ($1, $2, $3, $4, $5) returning id",
        [org.id, area ? await areaOf(area) : null, address ? titleCaseAddress(address) : `Käyttöpaikka ${unes}`, notes, unes],
      );
      stats.properties++;

      // Liittymät laskurivien tuotteista
      const firstDate = invs.map(periodStart).sort()[0];
      const kinds: ("water" | "wastewater")[] = [];
      if (rows.some((r) => WATER.test(r.tuote) && !WASTE.test(r.tuote))) kinds.push("water");
      if (rows.some((r) => WASTE.test(r.tuote))) kinds.push("wastewater");
      if (kinds.length === 0) kinds.push("water");
      const conn = new Map<string, string>();
      for (const k of kinds) {
        const [row] = await tx.query<{ id: string }>(
          "insert into ml_connections (organization_id, property_id, kind, connected_on, notes) values ($1, $2, $3, $4, 'Liittymispäivä ei tiedossa: ensimmäisen tuodun laskutusjakson alku.') returning id",
          [org.id, property, k, firstDate],
        );
        conn.set(k, row.id);
        stats.connections++;
      }

      // Mittarit ja lukemat
      const raw: RawReading[] = invs.flatMap((i) =>
        i.lukemat
          .map((r, position) => ({ r, position }))
          .filter(({ r }) => r.unes === unes && r.muoto !== "F" && r.edellinen !== null && r.uusi !== null)
          .map(({ r, position }) => ({
            invoice: i.laskunro ?? i.tiedosto.replace(/\D/g, ""),
            position,
            start: r.jakso_alku ?? null,
            end: r.jakso_loppu ?? invDate(i),
            previous: r.edellinen!,
            current: r.uusi!,
            multiplier: r.kerroin ?? 1,
            status: i.tarkistus.startsWith("ei täsmää") ? ("needs_review" as const) : ("accepted" as const),
            note: i.tarkistus.startsWith("ei täsmää") ? `Lasku ${i.laskunro}: ${i.tarkistus}` : null,
          })),
      );
      const chains = buildMeterChains(raw);
      stats.meterChanges += Math.max(0, chains.length - 1);
      for (const ch of chains) {
        const installedOn = ch.removedOn && ch.removedOn < ch.installedOn ? ch.removedOn : ch.installedOn;
        const [{ id: meter }] = await tx.query<{ id: string }>(
          `insert into ml_meters (organization_id, connection_id, read_method, installed_on, start_reading, multiplier, removed_on, final_reading, notes, legacy_id)
           values ($1, $2, $9, $3, $4, $5, $6, $7, $10, $8) returning id`,
          [org.id, conn.get("water") ?? conn.get("wastewater"), installedOn, ch.startReading, ch.multiplier, ch.removedOn, ch.finalReading, unes, "mechanical",
           // Laskuilla ei ole mittarinumeroa, joten lukutapa selviää vasta varmuuskopiosta (meterReadMethod).
           "Tuotu laskuilta: mittarinumero, lukutapa ja asennuspäivä eivät ole tiedossa."],
        );
        stats.meters++;
        for (const r of ch.readings) {
          await tx.query(
            "insert into ml_readings (organization_id, meter_id, read_on, reading, source, status, note) values ($1, $2, $3, $4, 'import', $5, $6)",
            [org.id, meter, r.readOn, r.reading, r.status, r.note],
          );
          stats.readings++;
          if (r.status === "needs_review") stats.review++;
          if (r.status === "rejected") stats.replaced++;
        }
      }

      // Sopimukset: maksajat laskujen järjestyksessä
      const segments: { customer: string; start: string }[] = [];
      for (const i of [...invs].sort((a, b) => periodStart(a).localeCompare(periodStart(b)))) {
        const c = customerOf.get(customerKey(i));
        if (!c) continue;
        if (segments.at(-1)?.customer !== c) segments.push({ customer: c, start: periodStart(i) });
      }
      for (let k = 0; k < segments.length; k++) {
        const s = segments[k];
        const next = segments[k + 1];
        const end = next ? dayBefore(next.start) : null;
        if (end && end < s.start) continue;
        await tx.query(
          `insert into ml_contracts (organization_id, property_id, customer_id, role, billed, starts_on, ends_on, notes)
           values ($1, $2, $3, 'owner', true, $4, $5, 'Tuotu laskuilta: alkupäivä on ensimmäisen tuodun laskutusjakson alku, rooli ei tiedossa.')`,
          [org.id, property, s.customer, s.start, end],
        );
        stats.contracts++;
      }
    }
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) throw err;
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}

console.log(`Laskuja ${stats.invoices} (hyvityslaskut ${stats.credits} ohitettu).`);
console.log(`Asiakkaat: yhdistetty luetteloon ${stats.matched} (${[...how].map(([k, v]) => `${k} ${v}`).join(", ")}), asiakasnumero lisätty ${stats.numbered}, uusia ${stats.created}.`);
console.log(`Kiinteistöjä ${stats.properties}, alueita ${stats.areas}, liittymiä ${stats.connections}, sopimuksia ${stats.contracts}.`);
console.log(`Mittareita ${stats.meters} (vaihtoja ${stats.meterChanges}), lukemia ${stats.readings}, tarkistettavia ${stats.review}, korvattuja ${stats.replaced}.`);
if (stats.noUnes) console.log(`Laskuja, joiden lukemalla ei ole käyttöpaikkaa: ${stats.noUnes} (ei tuotu).`);
