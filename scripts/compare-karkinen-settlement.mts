import { openTargetDb } from "./lib/target-db.mts";
import { loadOldInvoices, propertyMatcher } from "./lib/karkinen-invoices.mts";
import { loadOrgBillingData } from "../src/lib/billing/load.ts";
import { calculateBill, type BilledEstimate, type ConnectionKind } from "../src/lib/billing/calculate.ts";

/**
 * Kärkisen tasauslaskut uudelleen laskettuina.
 *
 *   npm run karkinen:vertaa-tasaus -- [--tiedosto data/private/karkinen/laskut/<nimi>.json] [--tuotanto]
 *
 * Laskee jokaiselle vanhan järjestelmän tasauslaskulle tasauksen samalla
 * moottorilla kuin laskutusajo. Arviolaskuilla laskutettu summa otetaan
 * laskun arviorivieltä (arviolaskuja ei ole tässä järjestelmässä vuodelta
 * 2025). Vertaa laskun loppusummaa ja kulutusta. Ei tallenna mitään.
 * Tuloste näyttää vain kiinteistön tunnuksen (huoneiston numero) ja summat.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const file = args.includes("--tiedosto") ? args[args.indexOf("--tiedosto") + 1] : "data/private/karkinen/laskut/2 VOK vesitasauslaskutus 31.12.2025.json";
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

const invoices = await loadOldInvoices(file);
const r = { same: 0, differ: [] as string[], m3Differ: 0, skipped: 0, total: 0, expected: 0, issues: 0 };
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy.`);
    const match = await propertyMatcher(tx, org.id);
    const { properties, tariffs } = await loadOrgBillingData(tx, org.id);
    for (const inv of invoices) {
      const p = match(inv);
      const usage = inv.rivit.find((x) => x.koodi === "032" || x.koodi === "033");
      if (!p || p === "ambiguous" || !usage?.alku || !usage.loppu) {
        r.skipped++;
        continue;
      }
      const data = properties.get(p.id)!;
      const billed: Partial<Record<ConnectionKind, BilledEstimate>> = {};
      for (const [code, kind, price] of [["034", "water", 2.23], ["035", "wastewater", 2.85]] as const) {
        const line = inv.rivit.find((x) => x.koodi === code);
        if (!line?.summa) continue;
        const gross = -line.summa;
        billed[kind] = { m3: Math.round((gross / price) * 1000) / 1000, gross, net: round2(gross / 1.255) };
      }
      const res = calculateBill({
        periodStart: dayBefore(usage.alku), periodEnd: usage.loppu, areaId: data.areaId, connections: data.connections, meters: data.meters,
        tariffs, mode: "settlement", billedEstimates: billed,
      });
      const expected = round2(inv.rivit.reduce((s, x) => s + (x.summa ?? 0), 0));
      r.total += res.gross;
      r.expected += expected;
      if (res.issues.length) r.issues++;
      if (usage.maara !== null && Math.abs(Math.max(res.waterM3, res.wastewaterM3) - usage.maara) > 0.001) r.m3Differ++;
      if (Math.abs(res.gross - expected) < 0.005) r.same++;
      else r.differ.push(`${p.code ?? "?"}: ${res.gross.toFixed(2)} / lasku ${expected.toFixed(2)}${res.issues.length ? ` (${res.issues[0].slice(0, 60)})` : ""}`);
    }
  });
} catch (err) {
  console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
  process.exitCode = 1;
} finally {
  await db.close();
}

console.log(`Tasauslaskuja ${invoices.length}: täsmää ${r.same}, eroaa ${r.differ.length}, ohitettu (ei kiinteistöä tai jaksoa) ${r.skipped}.`);
console.log(`Kulutus eroaa ${r.m3Differ}, huomautuksia ${r.issues}. Yhteensä ${round2(r.total)} €, laskuilla ${round2(r.expected)} €.`);
for (const d of r.differ) console.log(`  ${d}`);
