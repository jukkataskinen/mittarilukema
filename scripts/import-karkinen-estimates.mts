import { readFile } from "node:fs/promises";
import { openTargetDb } from "./lib/target-db.mts";
import { loadOldInvoices, propertyMatcher, type OldInvoice } from "./lib/karkinen-invoices.mts";

/**
 * Vanhassa järjestelmässä laskutetut kuukausiarviot tasausta varten (0019).
 *
 *   npm run karkinen:arviot -- [--vuosi 2026] [--kuiva] [--tuotanto]
 *
 * Lähteet (data/private/karkinen): kuukausilaskut (scripts/karkinen/parse_invoices.py → laskut/*.json)
 * sekä syyskuun ennakkolista (karkinen.json). Lasku kohdistetaan kiinteistöön
 * osoitteella, ja vanhan järjestelmän viitenumero opitaan osoitteella
 * kohdistetuista laskuista (viite on sama joka kuukausi).
 *
 * Kuukausi, jolta laskua ei ole, päätellään edellisestä tunnetusta kuukaudesta
 * (sama m³ ja sama euromäärä, koska hinta muuttuu vain kuukauden vaihteessa).
 * Päättely on varma, kun arvio on sama molemmin puolin; muuten rivi merkitään
 * tarkistettavaksi. Kuukaudet ennen ensimmäistä tunnettua kuukautta päätellään
 * tarkistettaviksi, jos liittymä on ollut voimassa.
 *
 * Uudelleenajo korvaa vuoden rivit. Tuloste näyttää vain määrät.
 */

const args = process.argv.slice(2);
const orgName = args.includes("--org") ? args[args.indexOf("--org") + 1] : "Kärkisten vesiosuuskunta";
const year = args.includes("--vuosi") ? args[args.indexOf("--vuosi") + 1] : "2026";
const dryRun = args.includes("--kuiva");
const DIR = "data/private/karkinen/laskut";
// Kuukausilaskujen tiedostot (jäsennetty); helmi- ja heinäkuu puuttuvat aineistosta.
const FILES: Record<string, string> = {
  "2026-01": "202601 laskut",
  "2026-03": "032026 laskut",
  "2026-04": "VOK huhtikuun laskutus",
  "2026-05": "202605 kopiot laskuista",
  "2026-06": "VOK kesäkuun laskutus",
  "2026-08": "VOK elokuun laskutus",
};
// Muiden kuukausien laskut, joista vain opitaan viitenumeron ja kiinteistön pari (viite on sama joka kuukausi).
const REF_ONLY_FILES = ["Laskut 2025 lokakuu", "Laskut 20251215", "Tilisiirrot syyskuun laskutus"];
const CODE: Record<string, "water" | "wastewater"> = { "034": "water", "035": "wastewater", "34": "water", "35": "wastewater" };
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type Amount = { m3: number; gross: number };
type Key = string; // property|kind
const known = new Map<Key, Map<string, Amount & { file: string }>>();
const stats = { files: 0, invoices: 0, byAddress: 0, byRef: 0, unidentified: 0, invoiceRows: 0, inferredSure: 0, inferredReview: 0, backfilled: 0 };

const add = (key: Key, month: string, a: Amount, file: string) => {
  const m = known.get(key) ?? new Map();
  const prev = m.get(month);
  m.set(month, prev ? { m3: round3(prev.m3 + a.m3), gross: round2(prev.gross + a.gross), file } : { ...a, file });
  known.set(key, m);
};

const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    const [org] = await tx.query<{ id: string }>("select id from ml_organizations where name = $1", [orgName]);
    if (!org) throw new Error(`Organisaatiota "${orgName}" ei löydy.`);
    const match = await propertyMatcher(tx, org.id);

    // 1. Laskut ja viitenumeron oppiminen osoitteella kohdistetuista.
    const files: [string, OldInvoice[]][] = [];
    for (const [month, name] of Object.entries(FILES)) {
      if (!month.startsWith(year)) continue;
      files.push([month, await loadOldInvoices(`${DIR}/${name}.json`)]);
      stats.files++;
    }
    const refToProperty = new Map<string, Set<string>>();
    const refSources: OldInvoice[][] = files.map(([, invs]) => invs);
    for (const name of REF_ONLY_FILES) {
      try {
        refSources.push(await loadOldInvoices(`${DIR}/${name}.json`));
      } catch {
        // Tiedosto ei ole pakollinen.
      }
    }
    for (const invs of refSources) {
      for (const inv of invs) {
        const p = match(inv);
        if (p && p !== "ambiguous" && inv.viite) refToProperty.set(inv.viite, new Set([...(refToProperty.get(inv.viite) ?? []), p.id]));
      }
    }
    for (const [month, invs] of files) {
      for (const inv of invs) {
        stats.invoices++;
        const p = match(inv);
        let propertyId: string | null = p && p !== "ambiguous" ? p.id : null;
        if (propertyId) stats.byAddress++;
        else if (inv.viite && refToProperty.get(inv.viite)?.size === 1) {
          propertyId = [...refToProperty.get(inv.viite)!][0];
          stats.byRef++;
        } else {
          stats.unidentified++;
          continue;
        }
        for (const r of inv.rivit) {
          const kind = CODE[r.koodi];
          if (!kind || r.maara === null || r.summa === null) continue;
          add(`${propertyId}|${kind}`, month, { m3: r.maara, gross: r.summa }, FILES[month]);
        }
      }
    }

    // 2. Syyskuu ennakkolistalta (huoneiston tunnus = asiakasnumero).
    const list = JSON.parse(await readFile("data/private/karkinen/karkinen.json", "utf8")) as { jakso: string; huoneistot: { tunnus: string; rivit: { koodi: string; maara: number | null; summa: number | null }[] }[] };
    const listMonth = `${list.jakso.slice(0, 4)}-${list.jakso.slice(4, 6)}`;
    if (listMonth.startsWith(year)) {
      const props = await tx.query<{ number: string; property_id: string }>(
        `select c.customer_number as number, k.property_id from ml_customers c join ml_contracts k on k.customer_id = c.id
          where c.organization_id = $1 and k.billed and k.ends_on is null`,
        [org.id],
      );
      const byNumber = new Map(props.map((x) => [x.number, x.property_id]));
      for (const u of list.huoneistot) {
        const propertyId = byNumber.get(u.tunnus);
        if (!propertyId) continue;
        for (const r of u.rivit) {
          const kind = CODE[r.koodi];
          if (!kind || r.maara === null || r.summa === null) continue;
          add(`${propertyId}|${kind}`, listMonth, { m3: r.maara, gross: r.summa }, "Ennakkotavoitelista");
        }
      }
    }

    // 3. Puuttuvat kuukaudet: välikuukaudet edellisestä, alkukuukaudet ensimmäisestä tunnetusta.
    const connections = await tx.query<{ property_id: string; kind: string; connected_on: string }>(
      "select property_id, kind, connected_on::text from ml_connections where organization_id = $1",
      [org.id],
    );
    const connectedOn = new Map(connections.map((c) => [`${c.property_id}|${c.kind}`, c.connected_on]));
    const lastKnownMonth = [...known.values()].flatMap((m) => [...m.keys()]).sort().at(-1) ?? `${year}-01`;
    const months = Array.from({ length: Number(lastKnownMonth.slice(5, 7)) }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    type Row = { propertyId: string; kind: string; month: string; m3: number; gross: number; source: "invoice" | "inferred"; file: string | null; review: boolean; note: string | null };
    const rows: Row[] = [];
    for (const [key, byMonth] of known) {
      const [propertyId, kind] = key.split("|");
      const knownMonths = months.filter((m) => byMonth.has(m));
      for (const month of months) {
        const own = byMonth.get(month);
        if (own) {
          rows.push({ propertyId, kind, month, m3: own.m3, gross: own.gross, source: "invoice", file: own.file, review: false, note: null });
          stats.invoiceRows++;
          continue;
        }
        const prev = knownMonths.filter((m) => m < month).at(-1);
        const next = knownMonths.find((m) => m > month);
        if (prev) {
          const p = byMonth.get(prev)!;
          const n = next ? byMonth.get(next)! : null;
          const sure = !!n && n.m3 === p.m3;
          rows.push({
            propertyId, kind, month, m3: p.m3, gross: p.gross, source: "inferred", file: null, review: !sure,
            note: sure ? `Päätelty: sama arvio ${prev} ja ${next}.` : n ? `Päätelty kuukaudesta ${prev}; arvio muuttui ennen kuukautta ${next}.` : `Päätelty kuukaudesta ${prev}.`,
          });
          if (sure) stats.inferredSure++;
          else stats.inferredReview++;
        } else if (next) {
          // Alkuvuosi puuttuu (lasku ei kohdistunut): päätellään vain, jos liittymä oli voimassa.
          const since = connectedOn.get(key);
          if (since && since <= `${month}-01`) {
            const n = byMonth.get(next)!;
            rows.push({ propertyId, kind, month, m3: n.m3, gross: n.gross, source: "inferred", file: null, review: true, note: `Päätelty taaksepäin kuukaudesta ${next}.` });
            stats.backfilled++;
          }
        }
      }
    }

    await tx.query("delete from ml_legacy_billed_estimates where organization_id = $1 and month >= $2 and month <= $3", [org.id, `${year}-01-01`, `${year}-12-01`]);
    await tx.query(
      `insert into ml_legacy_billed_estimates (organization_id, property_id, month, connection_kind, m3, net_eur, gross_eur, source, source_file, needs_review, note)
       select $1, x.property_id, (x.month || '-01')::date, x.kind, x.m3, round(x.gross / 1.255, 2), x.gross, x.source, x.file, x.review, x.note
         from json_to_recordset($2::json) as x(property_id uuid, month text, kind text, m3 numeric, gross numeric, source text, file text, review boolean, note text)`,
      [org.id, JSON.stringify(rows.map((r) => ({ property_id: r.propertyId, month: r.month, kind: r.kind, m3: r.m3, gross: r.gross, source: r.source, file: r.file, review: r.review, note: r.note })))],
    );
    await tx.query("insert into ml_audit_log (organization_id, action, entity, details) values ($1, 'import.karkinen_legacy_estimates', 'ml_legacy_billed_estimates', $2)", [
      org.id, JSON.stringify({ year, ...stats, rows: rows.length }),
    ]);
    console.log(`Kiinteistö-liittymäpareja ${known.size}, rivejä ${rows.length}.`);
    if (dryRun) throw new Error("__kuiva__");
  });
} catch (err) {
  if (!(err instanceof Error && err.message === "__kuiva__")) {
    console.log(`Virhe: ${err instanceof Error ? err.message : "tuntematon"}`);
    await db.close();
    process.exit(1);
  }
  console.log("Kuivaharjoitus: mitään ei tallennettu.");
} finally {
  await db.close();
}

console.log(`Laskutiedostoja ${stats.files}, laskuja ${stats.invoices}: osoitteella ${stats.byAddress}, viitteellä ${stats.byRef}, tunnistamatta ${stats.unidentified}.`);
console.log(`Laskuilta ${stats.invoiceRows} riviä. Päätelty varmasti ${stats.inferredSure}, tarkistettavaksi ${stats.inferredReview}, alkuvuosi taaksepäin (tarkistettava) ${stats.backfilled}.`);
