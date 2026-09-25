import { openTargetDb } from "./lib/target-db.mts";
import { deleteApprovedRun } from "../src/lib/billing/maintenance.ts";

/**
 * Virheellisesti hyväksytyn laskutusajon poisto (huoltotoimi, 0018).
 *
 *   npm run laskutus:poista-hyvaksytty -- --ajo <ajon tunnus> --syy "miksi" [--kuiva] [--tuotanto]
 *
 * Poistaa ajon laskuineen, riveineen ja Fennoa-vientitietoineen ja kirjaa syyn
 * muutoslokiin. Käytä vain, kun ajoa ei oikeasti laskuteta tällä
 * järjestelmällä: hyväksytyt arvioajot vähennetään tasauksessa.
 * Tulostaa vain määrät.
 */

const args = process.argv.slice(2);
const runId = args.includes("--ajo") ? args[args.indexOf("--ajo") + 1] : "";
const reason = args.includes("--syy") ? args[args.indexOf("--syy") + 1] : "";
if (!/^[0-9a-f-]{36}$/.test(runId ?? "") || !reason?.trim()) {
  console.log('Käyttö: npm run laskutus:poista-hyvaksytty -- --ajo <ajon tunnus> --syy "miksi" [--kuiva] [--tuotanto]');
  process.exit(1);
}

const db = await openTargetDb(args);
try {
  const r = await db.asService(async (tx) => {
    const res = await deleteApprovedRun(tx, { runId, reason: reason.trim() });
    if (args.includes("--kuiva")) throw Object.assign(new Error("__kuiva__"), { res });
    return res;
  });
  console.log(`Poistettu ajo (${r.org}, ${r.periodStart} – ${r.periodEnd}): laskuja ${r.invoices}, rivejä ${r.lines}, Fennoa-vientejä ${r.exports}.`);
} catch (err) {
  const e = err as Error & { res?: Awaited<ReturnType<typeof deleteApprovedRun>> };
  if (e.message === "__kuiva__" && e.res) {
    console.log(`Kuivaharjoitus, mitään ei poistettu: ${e.res.org}, ${e.res.periodStart} – ${e.res.periodEnd}, laskuja ${e.res.invoices}, rivejä ${e.res.lines}, Fennoa-vientejä ${e.res.exports}.`);
  } else {
    console.log(`Virhe: ${e.message ?? "tuntematon"} (mitään ei poistettu)`);
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
