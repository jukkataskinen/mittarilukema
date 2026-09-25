import { openTargetDb } from "./lib/target-db.mts";
import { loadOldInvoices, propertyMatcher } from "./lib/karkinen-invoices.mts";

/**
 * Kärkisen mittarit ja lukemat vanhan järjestelmän tasauslaskuilta.
 *
 *   python scripts/karkinen/parse_invoices.py "<kansio>/2 VOK vesitasauslaskutus 31.12.2025.pdf"
 *   npm run karkinen:lukemat -- [--tiedosto data/private/karkinen/laskut/<nimi>.json] [--kuiva] [--tuotanto]
 *
 * Tasauslaskun kulutusrivin alla on jakson alku- ja loppulukema
 * ("893,0 m3 - 913,0 m3"). Jokaisesta lukemaparista tulee kiinteistön
 * mittaaavalle liittymälle mittari (numero ei ole tiedossa) ja lukemat
 * jakson alku- ja loppupäivälle. Liittymän alkupäivä siirretään viimeistään
 * jakson alkuun, koska kiinteistö on laskutettu jaksolta.
 *
 * Uudelleenajo ei tuo samaa mittaria kahdesti (legacy_id "tasaus-<vuosi>-<n>").
 * Tuloste näyttää vain määrät.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const file = args.includes("--tiedosto") ? args[args.indexOf("--tiedosto") + 1] : "data/private/karkinen/laskut/2 VOK vesitasauslaskutus 31.12.2025.json";
const dryRun = args.includes("--kuiva");
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

const invoices = await loadOldInvoices(file);
const stats = { invoices: invoices.length, matched: 0, ambiguous: 0, unmatched: 0, noReadings: 0, existing: 0, meters: 0, readings: 0, qtyMismatch: 0, noConnection: 0, laterConnection: 0 };
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy.`);
    const match = await propertyMatcher(tx, org.id);
    for (const inv of invoices) {
      const p = match(inv);
      if (p === "ambiguous") stats.ambiguous++;
      if (!p || p === "ambiguous") {
        if (!p) stats.unmatched++;
        continue;
      }
      stats.matched++;
      // Sama mittari näkyy sekä vesi- että jätevesirivillä: lukemat otetaan jätevesiriviltä, muuten vesiriviltä.
      const usage = inv.rivit.filter((r) => r.koodi === "033" || r.koodi === "032");
      const source = usage.find((r) => r.koodi === "033" && r.lukemat.length) ?? usage.find((r) => r.lukemat.length);
      if (!source?.alku || !source.loppu) {
        stats.noReadings++;
        continue;
      }
      const consumption = source.lukemat.reduce((s, [a, b]) => s + (b - a), 0);
      if (source.maara !== null && Math.abs(consumption - source.maara) > 0.001) stats.qtyMismatch++;

      const start = dayBefore(source.alku);
      const year = source.loppu.slice(0, 4);
      // Laskulla olevat liittymät ovat olleet voimassa jaksolla. Jos laskulla ei ole
      // vesi- tai jätevesiriviä, se liittymä on tullut vasta jakson jälkeen (esim. 57 ja 155).
      const onInvoice = { water: inv.rivit.some((r) => r.koodi === "032"), wastewater: inv.rivit.some((r) => r.koodi === "033") };
      for (const kind of ["water", "wastewater"] as const) {
        if (onInvoice[kind]) {
          await tx.query("update ml_connections set connected_on = least(connected_on, $2::date) where property_id = $1 and kind = $3", [p.id, start, kind]);
        } else {
          const later = await tx.query(
            "update ml_connections set connected_on = greatest(connected_on, $2::date + 1) where property_id = $1 and kind = $3 returning id",
            [p.id, source.loppu, kind],
          );
          stats.laterConnection += later.length;
        }
      }
      const [conn] = await tx.query<{ id: string }>(
        "select id from ml_connections where property_id = $1 and disconnected_on is null order by (kind = 'water') desc limit 1",
        [p.id],
      );
      if (!conn) {
        stats.noConnection++;
        continue;
      }
      for (const [i, [a, b]] of source.lukemat.entries()) {
        const legacy = `tasaus-${year}-${i + 1}`;
        const exists = await tx.query("select 1 from ml_meters m join ml_connections c on c.id = m.connection_id where c.property_id = $1 and m.legacy_id = $2", [
          p.id, legacy,
        ]);
        if (exists.length) {
          stats.existing++;
          continue;
        }
        const [meter] = await tx.query<{ id: string }>(
          `insert into ml_meters (organization_id, connection_id, read_method, installed_on, start_reading, notes, legacy_id)
           values ($1, $2, 'mechanical', $3, $4, $5, $6) returning id`,
          [org.id, conn.id, start, a, `Lukemat vanhan järjestelmän tasauslaskulta ${year}. Mittarinumero ei tiedossa.`, legacy],
        );
        await tx.query(
          `insert into ml_readings (organization_id, meter_id, read_on, reading, source, note) values
             ($1, $2, $3, $4, 'import', $6), ($1, $2, $5, $7, 'import', $6)`,
          [org.id, meter.id, start, a, source.loppu, `Tasauslasku ${year}`, b],
        );
        stats.meters++;
        stats.readings += 2;
      }
    }
    await tx.query("insert into ml_audit_log (organization_id, action, entity, details) values ($1, 'import.karkinen_readings', 'ml_meters', $2)", [
      org.id, JSON.stringify(stats),
    ]);
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) {
    // Vain virheviesti: kannan virheolio sisältää kyselyn parametrit.
    console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
    await db.close();
    process.exit(1);
  }
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}

console.log(`Laskuja ${stats.invoices}: yhdistetty ${stats.matched}, sama osoite usealla kiinteistöllä ${stats.ambiguous}, ei kiinteistöä ${stats.unmatched}.`);
console.log(`Mittareita ${stats.meters}, lukemia ${stats.readings}, jo tuotu ${stats.existing}. Ilman lukemia ${stats.noReadings}, ilman liittymää ${stats.noConnection}.`);
if (stats.laterConnection) console.log(`Liittymä alkanut vasta jakson jälkeen (ei laskulla): ${stats.laterConnection}.`);
if (stats.qtyMismatch) console.log(`Laskun kulutus eroaa lukemien erotuksesta: ${stats.qtyMismatch}.`);
