import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { createBillingRun } from "../src/lib/billing/run.ts";

/**
 * Kärkisen arviolaskut ennakkolistaa vasten.
 *
 *   npm run karkinen:vertaa -- [--org "Kärkisten vesiosuuskunta"] [--tallenna] [--tuotanto]
 *
 * Laskee listan kuukaudelle arviolaskutusajon samalla koodilla kuin
 * käyttöliittymä ja vertaa jokaisen huoneiston laskun loppusummaa ja
 * arvonlisäveroa listaan. Ajo perutaan lopuksi, ellei --tallenna ole
 * annettu (silloin se jää luonnokseksi). Tuloste näyttää vain huoneiston
 * numerot ja summat.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const keep = args.includes("--tallenna");

type Row = { koodi: string; alv: number; summa: number | null };
const data = JSON.parse(await readFile("data/private/karkinen/karkinen.json", "utf8")) as { jakso: string; huoneistot: { tunnus: string; rivit: Row[] }[] };
const year = Number(data.jakso.slice(0, 4));
const month = Number(data.jakso.slice(4, 6));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const periodStart = iso(new Date(Date.UTC(year, month - 1, 0)));
const periodEnd = iso(new Date(Date.UTC(year, month, 0)));
const round2 = (n: number) => Math.round(n * 100) / 100;

const expected = new Map(
  data.huoneistot.map((u) => [u.tunnus, { gross: round2(u.rivit.reduce((s, r) => s + (r.summa ?? 0), 0)), vat: round2(u.rivit.reduce((s, r) => s + r.alv, 0)) }]),
);

const db = await openTargetDb(args);
const result = { same: 0, vatOnly: 0, differ: [] as string[], missing: [] as string[], extra: 0, withIssues: 0, total: 0, expectedTotal: 0 };
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy.`);
    const [owner] = await tx.query<{ user_id: string }>("select user_id from ml_org_members where organization_id = $1 and role = 'owner' limit 1", [org.id]);
    if (!owner) throw new Error("Organisaatiolla ei ole pääkäyttäjää.");
    await tx.query("delete from ml_billing_runs where organization_id = $1 and status = 'draft' and kind = 'estimate' and period_start = $2 and period_end = $3", [
      org.id, periodStart, periodEnd,
    ]);
    const run = await createBillingRun(tx, {
      organizationId: org.id, userId: owner.user_id, periodStart, periodEnd, kind: "estimate", note: `Ennakkolista ${month}/${year}`,
    });
    const rows = await tx.query<{ nro: string; gross: string; vat: string; issues: string[] }>(
      `select c.customer_number as nro, i.gross_eur::text as gross, i.vat_eur::text as vat, i.issues
         from ml_invoices i join ml_customers c on c.id = i.customer_id where i.run_id = $1`,
      [run.runId],
    );
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.nro);
      result.total += Number(r.gross);
      if (r.issues.length) result.withIssues++;
      const e = expected.get(r.nro);
      if (!e) {
        result.extra++;
        continue;
      }
      if (Math.abs(Number(r.gross) - e.gross) >= 0.005) result.differ.push(`${r.nro}: ${r.gross} / lista ${e.gross}`);
      else if (Math.abs(Number(r.vat) - e.vat) >= 0.005) result.vatOnly++;
      else result.same++;
    }
    for (const [nro, e] of expected) {
      result.expectedTotal += e.gross;
      // Huoneisto, jolta ei veloiteta listalla mitään, ei tarvitse laskua.
      if (!seen.has(nro) && e.gross !== 0) result.missing.push(nro);
    }
    if (!keep) throw new Error("__peru__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__peru__")) {
    // Vain virheviesti: kannan virheolio sisältää kyselyn parametrit eli henkilötietoja.
    console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
    await db.close();
    process.exit(1);
  }
} finally {
  await db.close();
}

console.log(`Jakso ${periodStart} - ${periodEnd}: laskuja ${result.same + result.vatOnly + result.differ.length + result.extra}, listan huoneistoja ${expected.size}.`);
console.log(`Loppusumma ja alv täsmäävät ${result.same}, vain alv eroaa sentin ${result.vatOnly}, loppusumma eroaa ${result.differ.length}.`);
console.log(`Yhteensä ${round2(result.total)} €, lista ${round2(result.expectedTotal)} €. Laskuja, joilla huomautus: ${result.withIssues}.`);
if (result.missing.length) console.log(`Listalla, mutta ei laskua: ${result.missing.join(", ")}`);
if (result.extra) console.log(`Lasku ilman listan huoneistoa: ${result.extra}`);
for (const d of result.differ) console.log(`  ${d}`);
console.log(keep ? "Ajo tallennettu luonnokseksi." : "Ajo peruttu (lisää --tallenna, jos haluat sen luonnokseksi).");
