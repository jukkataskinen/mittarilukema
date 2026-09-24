/**
 * Fennoan myyntilaskuaineiston tuonnin puhdas logiikka: nimien vertailu,
 * osoitteiden muotoilu ja mittariketjujen päättely lukemista. Kantaan
 * kirjoittaa `scripts/import-fennoa-invoices.mts`.
 */

/** Vertailumuoto: pienet kirjaimet, vain kirjaimet ja numerot, sanat aakkosjärjestyksessä. */
export function nameKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9åäöéü ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function streetKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9åäöéü]/g, "");
}

/** Sørensen–Dice-kerroin merkkipareista: 1 = sama, 0 = ei yhteistä. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let hit = 0;
  for (const [k, n] of pa) hit += Math.min(n, pb.get(k) ?? 0);
  return (2 * hit) / (a.length - 1 + (b.length - 1));
}

/** "LEIVONMÄENTIE 23 B" → "Leivonmäentie 23 B". Kirjaintunnukset (A, B) ja numerot säilyvät. */
export function titleCaseAddress(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length <= 1 || /\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .map((w) => w.replace(/-(\p{L})/gu, (_, c: string) => `-${c.toUpperCase()}`))
    .join(" ");
}

export interface CustomerCandidate {
  id: string;
  name: string;
  street: string | null;
  postalCode: string | null;
}

export interface BillingInfo {
  name: string;
  street: string | null;
  postalCode: string | null;
}

/**
 * Laskun asiakas asiakasluettelosta. Järjestys: sama nimi ja katuosoite;
 * saman postinumeron sisällä lähes sama nimi; sama katuosoite ja
 * samankaltainen nimi ("Virtanen Matti" ja "Virtanen Matti ja Liisa").
 * Palauttaa null, jos vastinetta ei ole tai paras vastine ei ole yksiselitteinen.
 */
export function matchCustomer(b: BillingInfo, candidates: CustomerCandidate[]): { id: string; how: string } | null {
  const n = nameKey(b.name);
  const s = streetKey(b.street);
  const exact = candidates.filter((c) => nameKey(c.name) === n && streetKey(c.street) === s);
  if (exact.length === 1) return { id: exact[0].id, how: "nimi ja osoite" };
  const pool = (exact.length > 1 ? exact : candidates).filter((c) => !b.postalCode || c.postalCode === b.postalCode);
  const scored = pool
    .map((c) => ({ c, name: similarity(n, nameKey(c.name)), street: similarity(s, streetKey(c.street)) }))
    .filter((x) => x.name >= 0.9 || (x.street >= 0.9 && x.name >= 0.6))
    .sort((x, y) => y.name + y.street - (x.name + x.street));
  if (scored.length === 0) return null;
  if (scored.length > 1 && Math.abs(scored[0].name + scored[0].street - (scored[1].name + scored[1].street)) < 0.05) return null;
  return { id: scored[0].c.id, how: scored[0].name >= 0.9 ? "samankaltainen nimi" : "sama osoite, samankaltainen nimi" };
}

export interface RawReading {
  invoice: string;
  /** Järjestys laskun sisällä: mittarinvaihdossa vanhan mittarin lukema on ensin. */
  position: number;
  start: string | null;
  end: string;
  previous: number;
  current: number;
  multiplier: number;
  status: "accepted" | "needs_review";
  note: string | null;
}

export interface MeterChain {
  installedOn: string;
  startReading: number;
  multiplier: number;
  removedOn: string | null;
  finalReading: number | null;
  readings: { readOn: string; reading: number; status: "accepted" | "needs_review" | "rejected"; note: string | null }[];
}

/**
 * Käyttöpaikan lukemat mittareiksi. Uusi mittari alkaa, kun samalla laskulla
 * on toinen lukemarivi (vaihto: vanhan loppulukema ja uuden lukema nollasta)
 * tai kun kerroin vaihtuu. Saman päivän ristiriitaisista lukemista myöhemmän
 * laskun lukema jää voimaan (korjauslasku) ja aiempi hylätään.
 */
export function buildMeterChains(input: RawReading[]): MeterChain[] {
  // Saman laskun rivit: nollasta alkava (uusi) mittari aina viimeiseksi, vaikka se olisi laskulla ensin.
  const isNew = (r: RawReading) => (r.previous === 0 ? 1 : 0);
  const rs = [...input].sort(
    (a, b) => a.end.localeCompare(b.end) || Number(a.invoice) - Number(b.invoice) || isNew(a) - isNew(b) || a.position - b.position,
  );
  const chains: MeterChain[] = [];
  let cur: MeterChain | null = null;
  let last: RawReading | null = null;
  for (const r of rs) {
    const lastValue = cur?.readings.filter((x) => x.status !== "rejected").at(-1)?.reading ?? cur?.startReading ?? 0;
    // Saman laskun toinen lukemarivi on toinen mittari: vaihto.
    const change = cur && last && ((last.invoice === r.invoice && last.position !== r.position) || r.multiplier !== cur.multiplier);
    if (!cur || change) {
      if (cur && last) {
        cur.removedOn = last.end;
        cur.finalReading = lastValue;
      }
      const installedOn: string = cur && last ? last.end : (r.start ?? r.end);
      cur = { installedOn, startReading: r.previous, multiplier: r.multiplier, removedOn: null, finalReading: null, readings: [] };
      chains.push(cur);
    }
    const same = cur.readings.find((x) => x.readOn === r.end && x.status !== "rejected");
    if (same) {
      if (same.reading === r.current) {
        last = r;
        continue;
      }
      same.status = "rejected";
      same.note = "Korvattu myöhemmän laskun lukemalla";
    }
    cur.readings.push({ readOn: r.end, reading: r.current, status: r.status, note: r.note });
    last = r;
  }
  return chains;
}
