import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { decodeCsv, parseFennoaCostCenters, parseFennoaProducts } from "../src/lib/products/fennoa-csv.ts";
import { joutsaRule } from "../src/lib/products/joutsa.ts";

/**
 * Fennoan tuotelista tuoterekisteriksi: tuotteet, kirjanpitotilit ja
 * laskentakohteet (kustannuspaikat).
 *
 *   npm run tuotteet:tuo -- <tuotteet.csv> --org "Nimi" [--laskentakohteet <tiedosto.csv>] [--joutsa] [--kuiva] [--tuotanto]
 *
 * --laskentakohteet tuo Fennoan laskentakohdeluettelon (koodi, nimi, selite,
 * aktiivinen), jossa voi olla myös kohteita, joita tuotteet eivät käytä.
 *
 * Tuote päivitetään koodin perusteella, joten tuonnin voi ajaa uudelleen.
 * --joutsa asettaa säännöt tuotenimistä (src/lib/products/joutsa.ts):
 * mille laskuriveille tuote valitaan automaattisesti.
 */

const args = process.argv.slice(2);
const valueOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const ccFile = valueOf("--laskentakohteet");
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--org" && args[i - 1] !== "--laskentakohteet");
const org = args[args.indexOf("--org") + 1];
const dryRun = args.includes("--kuiva");
const joutsa = args.includes("--joutsa");
if (!file || !args.includes("--org") || !org) {
  console.error('Käyttö: npm run tuotteet:tuo -- <tuotteet.csv> --org "Nimi" [--joutsa] [--kuiva] [--tuotanto]');
  process.exit(1);
}

const rows = parseFennoaProducts(decodeCsv(new Uint8Array(await readFile(file))));
const costCenterRows = ccFile ? parseFennoaCostCenters(decodeCsv(new Uint8Array(await readFile(ccFile)))) : [];
const db = await openTargetDb(args);
const stats = { products: 0, created: 0, accounts: 0, costCenters: 0, auto: 0, withoutCostCenter: 0 };
try {
  await db.asService(async (tx) => {
    const [o] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [org]);
    if (!o) throw new Error(`Organisaatiota ${org} ei löydy.`);
    const areas = new Map(
      (await tx.query<{ id: string; name: string }>("select id, name from ml_areas where organization_id = $1", [o.id])).map((a) => [a.name.toLowerCase(), a.id]),
    );

    const accountIds = new Map<string, string>();
    for (const code of [...new Set(rows.map((r) => r.account).filter((a): a is string => !!a))]) {
      const [a] = await tx.query<{ id: string; created: boolean }>(
        `insert into ml_accounts (organization_id, code) values ($1, $2)
         on conflict (organization_id, code) do update set code = excluded.code returning id, (xmax = 0) as created`,
        [o.id, code],
      );
      accountIds.set(code, a.id);
      if (a.created) stats.accounts++;
    }
    const ccIds = new Map<string, string>();
    for (const cc of costCenterRows) {
      const [c] = await tx.query<{ id: string; created: boolean }>(
        `insert into ml_cost_centers (organization_id, code, name, description, active) values ($1, $2, $3, $4, $5)
         on conflict (organization_id, code) do update set name = excluded.name, description = excluded.description, active = excluded.active
         returning id, (xmax = 0) as created`,
        [o.id, cc.code, cc.name, cc.description, cc.active],
      );
      ccIds.set(cc.code, c.id);
      if (c.created) stats.costCenters++;
    }
    for (const cc of rows.map((r) => r.costCenter).filter((c): c is { code: string; name: string } => !!c)) {
      if (ccIds.has(cc.code)) continue;
      const [c] = await tx.query<{ id: string; created: boolean }>(
        `insert into ml_cost_centers (organization_id, code, name) values ($1, $2, $3)
         on conflict (organization_id, code) do update set name = excluded.name returning id, (xmax = 0) as created`,
        [o.id, cc.code, cc.name],
      );
      ccIds.set(cc.code, c.id);
      if (c.created) stats.costCenters++;
    }

    for (const r of rows) {
      const rule = joutsa ? joutsaRule(r.name) : null;
      // Alue sääntöön vain, jos se on organisaatiolla; muuten tuote jää käsin valittavaksi.
      const areaId = rule?.areaName ? (areas.get(rule.areaName.toLowerCase()) ?? null) : null;
      const auto = !!rule?.autoMatch && (!rule.areaName || !!areaId);
      const [p] = await tx.query<{ created: boolean }>(
        `insert into ml_products (organization_id, code, name, unit, default_price_eur, vat_percent, account_id, cost_center_id,
                                  auto_match, match_charge_type, match_connection_kind, match_fee_class, match_area_id, match_customer_group, match_metered)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (organization_id, code) do update set
           name = excluded.name, unit = excluded.unit, default_price_eur = excluded.default_price_eur, vat_percent = excluded.vat_percent,
           account_id = excluded.account_id, cost_center_id = excluded.cost_center_id,
           auto_match = case when $16 then excluded.auto_match else ml_products.auto_match end,
           match_charge_type = case when $16 then excluded.match_charge_type else ml_products.match_charge_type end,
           match_connection_kind = case when $16 then excluded.match_connection_kind else ml_products.match_connection_kind end,
           match_fee_class = case when $16 then excluded.match_fee_class else ml_products.match_fee_class end,
           match_area_id = case when $16 then excluded.match_area_id else ml_products.match_area_id end,
           match_customer_group = case when $16 then excluded.match_customer_group else ml_products.match_customer_group end,
           match_metered = case when $16 then excluded.match_metered else ml_products.match_metered end
         returning (xmax = 0) as created`,
        [
          o.id, r.code, r.name, r.unit, r.price, r.vatPercent, r.account ? accountIds.get(r.account) : null, r.costCenter ? ccIds.get(r.costCenter.code) : null,
          auto, rule?.chargeType ?? null, rule?.connectionKind ?? null, rule?.feeClass ?? null, areaId, rule?.customerGroup ?? null, rule?.metered ?? null,
          joutsa,
        ],
      );
      stats.products++;
      if (p.created) stats.created++;
      if (auto) stats.auto++;
      if (!r.costCenter) stats.withoutCostCenter++;
    }
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) throw err;
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}
console.log(
  `Tuotteita ${stats.products} (uusia ${stats.created}), automaattisesti valittavia ${stats.auto}, ilman laskentakohdetta ${stats.withoutCostCenter}. ` +
    `Uusia tilejä ${stats.accounts}, uusia laskentakohteita ${stats.costCenters}.`,
);
