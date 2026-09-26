import { openTargetDb } from "./lib/target-db.mts";
import { agreedAnnualM3, loadOrgBillingData } from "../src/lib/billing/load.ts";
import { calculateBill } from "../src/lib/billing/calculate.ts";
import { loadProducts, resolveProduct } from "../src/lib/products/index.ts";

/**
 * Tuoterekisterin kattavuus: lasketaan jakson laskut (tallentamatta) ja
 * kerrotaan, montako riviä saa tuotteen ja mitkä rivit jäävät ilman.
 *
 *   npm run tuotteet:tarkista -- --org "Nimi" [--alku 2026-03-31] [--loppu 2026-09-30] [--tuotanto]
 *
 * Tulostaa vain rivien kuvaukset, tuotekoodit ja määrät, ei asiakastietoja.
 */

const args = process.argv.slice(2);
const valueOf = (flag: string, def?: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : def);
const org = valueOf("--org");
const start = valueOf("--alku", "2026-03-31")!;
const end = valueOf("--loppu", "2026-09-30")!;
if (!org) {
  console.error('Käyttö: npm run tuotteet:tarkista -- --org "Nimi" [--alku pvm] [--loppu pvm] [--tuotanto]');
  process.exit(1);
}

const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [o] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [org]);
    if (!o) throw new Error(`Organisaatiota ${org} ei löydy.`);
    const { properties, tariffs, occupantM3PerYear } = await loadOrgBillingData(tx, o.id);
    const products = await loadProducts(tx, o.id);
    // Maksajan asiakasryhmä: jakson lopussa voimassa oleva laskutettava sopimus.
    const groups = new Map(
      (
        await tx.query<{ property_id: string; customer_group: string | null }>(
          `select distinct on (c.property_id) c.property_id, cu.customer_group from ml_contracts c join ml_customers cu on cu.id = c.customer_id
            where c.organization_id = $1 and c.billed and c.starts_on <= $2 and (c.ends_on is null or c.ends_on >= $2)
            order by c.property_id, c.role`,
          [o.id, end],
        )
      ).map((r) => [r.property_id, r.customer_group]),
    );
    const byProduct = new Map<string, number>();
    const missing = new Map<string, number>();
    let lines = 0;
    for (const p of properties.values()) {
      if (!p.connections.length) continue;
      const res = calculateBill({
        periodStart: start, periodEnd: end, areaId: p.areaId, connections: p.connections, meters: p.meters, tariffs,
        propertyCharges: p.charges, loans: p.loans, agreedAnnualM3: agreedAnnualM3(p, occupantM3PerYear),
      });
      const ctx = { areaId: p.areaId, customerGroup: groups.get(p.propertyId) ?? null, metered: p.meters.some((m) => m.installedOn <= end && (m.removedOn === null || m.removedOn > start)) };
      for (const l of res.lines) {
        lines++;
        const prod = resolveProduct(products, l, ctx);
        if (prod) byProduct.set(`${prod.code} ${prod.name}`, (byProduct.get(`${prod.code} ${prod.name}`) ?? 0) + 1);
        else missing.set(l.description, (missing.get(l.description) ?? 0) + 1);
      }
    }
    const miss = [...missing.values()].reduce((a, b) => a + b, 0);
    console.log(`Jakso ${start} – ${end}: rivejä ${lines}, tuote löytyi ${lines - miss}, ilman tuotetta ${miss}.`);
    for (const [k, n] of [...byProduct.entries()].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
    if (missing.size) {
      console.log("Ilman tuotetta:");
      for (const [k, n] of missing) console.log(`  ${String(n).padStart(5)}  ${k}`);
    }
  });
} finally {
  await db.close();
}
