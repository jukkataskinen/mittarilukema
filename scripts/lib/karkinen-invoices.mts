import { readFile } from "node:fs/promises";
import type { Sql } from "../../src/lib/db/types.ts";

/** scripts/karkinen/parse_invoices.py:n tuottama lasku. */
export interface OldInvoice {
  osoiterivi: string | null;
  vastaanottaja?: string | null;
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
  const rows = await tx.query<{ id: string; street_address: string; property_code: string | null; payer: string | null }>(
    `select p.id, p.street_address, p.property_code,
            (select c.name from ml_contracts k join ml_customers c on c.id = k.customer_id
              where k.property_id = p.id and k.billed order by k.ends_on nulls first, k.starts_on desc limit 1) as payer
       from ml_properties p where p.organization_id = $1`,
    [orgId],
  );
  type Hit = { id: string; code: string | null; payer: string | null };
  const byAddress = new Map<string, Hit[]>();
  for (const r of rows) byAddress.set(norm(r.street_address), [...(byAddress.get(norm(r.street_address)) ?? []), { id: r.id, code: r.property_code, payer: r.payer }]);
  // Saman tai lähes saman osoitteen kiinteistöt ratkaistaan laskun vastaanottajan nimellä.
  const tokens = (s: string | null | undefined) => new Set((s ?? "").toLowerCase().match(/[a-zåäö]{4,}/g) ?? []);
  const byName = (hits: Hit[], invoice: OldInvoice): Hit | null => {
    const t = tokens(invoice.vastaanottaja);
    const named = hits.filter((h) => [...tokens(h.payer)].some((x) => t.has(x)));
    return named.length === 1 ? named[0] : null;
  };
  const strip = (h: Hit) => ({ id: h.id, code: h.code });
  return (invoice: OldInvoice): { id: string; code: string | null } | "ambiguous" | null => {
    const words = (invoice.osoiterivi ?? "").split(/\s+/);
    const suffixes = words.map((_, k) => norm(words.slice(k).join(" "))).filter(Boolean);
    for (const suffix of suffixes) {
      const hit = byAddress.get(suffix);
      if (hit) {
        if (hit.length === 1) return strip(hit[0]);
        const n = byName(hit, invoice);
        return n ? strip(n) : "ambiguous";
      }
    }
    // Kirjoitusvirhe osoitteessa: paras osoite, jos se on lähes sama (≥ 0,85) ja selvästi
    // (≥ 0,05) parempi kuin seuraava. Muuten lasku jää kohdistamatta.
    const ranked = [...byAddress]
      .map(([address, hits]) => ({ score: Math.max(...suffixes.map((sfx) => similarity(sfx, address))), hits }))
      .sort((x, y) => y.score - x.score);
    const [first, second] = ranked;
    if (!first || first.score < 0.85) return null;
    if ((second && first.score - second.score < 0.05) || first.hits.length > 1) {
      // Tasapeli: ehdokkaat, jotka ovat lähes yhtä hyviä, ratkaistaan nimellä.
      const close = ranked.filter((x) => x.score >= first.score - 0.05 && x.score >= 0.85).flatMap((x) => x.hits);
      const n = byName(close, invoice);
      return n ? strip(n) : "ambiguous";
    }
    return strip(first.hits[0]);
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
