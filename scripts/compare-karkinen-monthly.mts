import { openTargetDb } from "./lib/target-db.mts";
import { loadOldInvoices, propertyMatcher } from "./lib/karkinen-invoices.mts";
import { createBillingRun } from "../src/lib/billing/run.ts";

/**
 * Kärkisen arviolaskutusajo vanhan järjestelmän kuukausilaskuja vasten.
 *
 *   npm run karkinen:vertaa-kk -- --tiedosto "data/private/karkinen/laskut/202605 kopiot laskuista.json" [--tuotanto]
 *
 * Laskee laskujen kuukaudelle arviolaskutusajon ja vertaa kiinteistöittäin
 * loppusummaa sekä maksuryhmittäin: perusmaksu (030), kulutusarvio (034, 035),
 * muut maksut (031, 040, 050) ja lainaosuus (021, 022). Ajo perutaan aina.
 * Tuloste näyttää vain määrät ja huoneistonumerot.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const file = args.includes("--tiedosto") ? args[args.indexOf("--tiedosto") + 1] : null;
if (!file) {
  console.log('Käyttö: npm run karkinen:vertaa-kk -- --tiedosto "data/private/karkinen/laskut/<nimi>.json"');
  process.exit(1);
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
type Group = "basic" | "usage" | "other" | "loan";
const GROUP_BY_CODE: Record<string, Group> = { "030": "basic", "034": "usage", "035": "usage", "021": "loan", "022": "loan" };
const groupOfLine = (kind: string, description: string): Group =>
  kind === "basic_fee" ? "basic" : kind === "usage" ? "usage" : /^Pääoman lyhennys|^Korko/.test(description) ? "loan" : "other";

const invoices = await loadOldInvoices(file);
const first = invoices.flatMap((i) => i.rivit).find((r) => r.koodi === "030" && r.alku && r.loppu);
if (!first?.alku || !first.loppu) throw new Error("Laskuilta ei löytynyt perusmaksun jaksoa.");
const periodStart = dayBefore(first.alku);
const periodEnd = first.loppu;

const r = { same: 0, differ: 0, unmatched: 0, ambiguous: 0, missing: 0, total: 0, expected: 0, byGroup: { basic: 0, usage: 0, other: 0, loan: 0 } as Record<Group, number>, onlyLoan: 0, examples: [] as string[] };
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy.`);
    const [owner] = await tx.query<{ user_id: string }>("select user_id from ml_org_members where organization_id = $1 and role = 'owner' limit 1", [org.id]);
    await tx.query("delete from ml_billing_runs where organization_id = $1 and status = 'draft' and kind = 'estimate' and period_start = $2 and period_end = $3", [
      org.id, periodStart, periodEnd,
    ]);
    const run = await createBillingRun(tx, { organizationId: org.id, userId: owner.user_id, periodStart, periodEnd, kind: "estimate" });
    const lines = await tx.query<{ property_id: string; code: string | null; kind: string; description: string; gross: string }>(
      `select i.property_id, p.property_code as code, l.kind, l.description, (l.net_eur + coalesce(l.vat_eur, 0))::text as gross
         from ml_invoices i join ml_properties p on p.id = i.property_id join ml_invoice_lines l on l.invoice_id = i.id where i.run_id = $1`,
      [run.runId],
    );
    const ours = new Map<string, { code: string | null; groups: Record<Group, number> }>();
    for (const l of lines) {
      const o = ours.get(l.property_id) ?? { code: l.code, groups: { basic: 0, usage: 0, other: 0, loan: 0 } };
      o.groups[groupOfLine(l.kind, l.description)] += Number(l.gross);
      ours.set(l.property_id, o);
    }
    const match = await propertyMatcher(tx, org.id);
    for (const inv of invoices) {
      const p = match(inv);
      if (p === "ambiguous") r.ambiguous++;
      if (!p || p === "ambiguous") {
        if (!p) r.unmatched++;
        continue;
      }
      const expected: Record<Group, number> = { basic: 0, usage: 0, other: 0, loan: 0 };
      for (const line of inv.rivit) expected[GROUP_BY_CODE[line.koodi] ?? "other"] += line.summa ?? 0;
      const got = ours.get(p.id)?.groups ?? { basic: 0, usage: 0, other: 0, loan: 0 };
      if (!ours.has(p.id)) r.missing++;
      const diffs = (Object.keys(expected) as Group[]).filter((g) => Math.abs(round2(got[g]) - round2(expected[g])) >= 0.005);
      const sum = (x: Record<Group, number>) => round2(Object.values(x).reduce((s, v) => s + v, 0));
      r.total += sum(got);
      r.expected += sum(expected);
      if (!diffs.length) {
        r.same++;
        continue;
      }
      r.differ++;
      for (const g of diffs) r.byGroup[g]++;
      if (diffs.length === 1 && diffs[0] === "loan") r.onlyLoan++;
      if (r.examples.length < 15 && !(diffs.length === 1 && diffs[0] === "loan")) {
        r.examples.push(`${p.code ?? "?"}: ${diffs.map((g) => `${g} ${round2(got[g]).toFixed(2)} / ${round2(expected[g]).toFixed(2)}`).join(", ")}`);
      }
    }
    throw new Error("__peru__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__peru__")) {
    console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
    await db.close();
    process.exit(1);
  }
} finally {
  await db.close();
}

console.log(`Jakso ${periodStart} - ${periodEnd}: vanhoja laskuja ${invoices.length}, yhdistämättä ${r.unmatched}, sama osoite usealla ${r.ambiguous}, meiltä ei laskua ${r.missing}.`);
console.log(`Täsmää ${r.same}, eroaa ${r.differ} (vain lainaosuus ${r.onlyLoan}). Eroja ryhmittäin: perusmaksu ${r.byGroup.basic}, kulutusarvio ${r.byGroup.usage}, muut maksut ${r.byGroup.other}, laina ${r.byGroup.loan}.`);
console.log(`Yhteensä ${round2(r.total)} €, vanhoilla laskuilla ${round2(r.expected)} €.`);
for (const e of r.examples) console.log(`  ${e}`);
