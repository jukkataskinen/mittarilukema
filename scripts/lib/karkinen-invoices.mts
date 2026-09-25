import { readFile } from "node:fs/promises";
import type { Sql } from "../../src/lib/db/types.ts";

/** scripts/karkinen/parse_invoices.py:n tuottama lasku. */
export interface OldInvoice {
  osoiterivi: string | null;
  viite: string | null;
  paiva: string | null;
  erapaiva: string | null;
  rivit: { koodi: string; laji: string; alku: string | null; loppu: string | null; maara: number | null; hinta: number | null; summa: number | null; lukemat: [number, number][] }[];
  yhteensa: number | null;
}

export async function loadOldInvoices(file: string): Promise<OldInvoice[]> {
  return (JSON.parse(await readFile(file, "utf8")) as { laskut: OldInvoice[] }).laskut;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9åäö]/g, "");

/**
 * Laskun kohde kiinteistöksi: osoiterivin alussa on otsikko, joten verrataan
 * rivin loppuosia kiinteistön osoitteeseen. Sama osoite usealla kiinteistöllä
 * (huoneistot 39 ja 160) jää yhdistämättä.
 */
export async function propertyMatcher(tx: Sql, orgId: string) {
  const rows = await tx.query<{ id: string; street_address: string; property_code: string | null }>(
    "select id, street_address, property_code from ml_properties where organization_id = $1",
    [orgId],
  );
  const byAddress = new Map<string, { id: string; code: string | null }[]>();
  for (const r of rows) byAddress.set(norm(r.street_address), [...(byAddress.get(norm(r.street_address)) ?? []), { id: r.id, code: r.property_code }]);
  return (invoice: OldInvoice): { id: string; code: string | null } | "ambiguous" | null => {
    const words = (invoice.osoiterivi ?? "").split(/\s+/);
    const suffixes = words.map((_, k) => norm(words.slice(k).join(" "))).filter(Boolean);
    for (const suffix of suffixes) {
      const hit = byAddress.get(suffix);
      if (hit) return hit.length === 1 ? hit[0] : "ambiguous";
    }
    // Kirjoitusvirhe osoitteessa: hyväksytään vain lähes sama (≥ 0,9) ja yksiselitteinen.
    const scored = [...byAddress].flatMap(([address, hits]) => suffixes.map((sfx) => ({ score: similarity(sfx, address), hits })));
    const best = scored.filter((x) => x.score >= 0.9);
    return best.length === 1 && best[0].hits.length === 1 ? best[0].hits[0] : best.length ? "ambiguous" : null;
  };
}

/** Merkkijonojen samankaltaisuus 0–1 muokkausetäisyydestä. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
