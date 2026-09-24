/**
 * Toteutuneen kulutuksen laskun laskenta yhdelle kiinteistölle ja jaksolle.
 *
 * Puhdas funktio: tiedot annetaan valmiina (src/lib/billing/load.ts), jotta
 * laskenta on testattavissa ja sama moottori palvelee laskutusajoa,
 * esikatselua ja vertailua vanhan järjestelmän laskuihin.
 *
 * Säännöt (Joutsan laskuaineisto 2026 ja julkinen hinnasto):
 * - Kulutus mittareittain: jakson loppua lähimmän hyväksytyn lukeman ja sitä
 *   edeltävän lukeman (tai mittarin aloituslukeman) erotus × kerroin.
 *   Jakson aikana vaihdetun mittarin kulutus lasketaan loppulukemaan asti.
 * - Jäteveden kulutus on vesimittarin kulutus. Jos kiinteistöllä on vain
 *   jätevesiliittymä, mittari on sen liittymän mittari.
 * - Perusmaksu kuukausittain niiltä kuukausilta, joina liittymä on voimassa,
 *   liittymän perusmaksuluokan hinnalla.
 * - Hinnanmuutos kesken jakson: perusmaksu kuukauden alun hinnalla,
 *   käyttömaksu jaetaan päivien suhteessa.
 * - Hinnat ilman arvonlisäveroa, rivin veroton summa pyöristetään senteille.
 */

export type ConnectionKind = "water" | "wastewater";

export interface BillingConnection {
  id: string;
  kind: ConnectionKind;
  feeClass: string | null;
  connectedOn: string;
  disconnectedOn: string | null;
}

export interface BillingReading {
  readOn: string;
  reading: number;
}

export interface BillingMeter {
  id: string;
  connectionId: string;
  installedOn: string;
  startReading: number;
  removedOn: string | null;
  finalReading: number | null;
  multiplier: number;
  /** Vain hyväksytyt lukemat. */
  readings: BillingReading[];
}

export interface BillingTariff {
  chargeType: "basic_fee" | "usage_fee" | "loan_share" | "extra_basic_fee" | "other";
  connectionKind: ConnectionKind | null;
  feeClass: string | null;
  areaId: string | null;
  name: string;
  unit: "m3" | "month" | "year" | "piece";
  priceEur: number;
  vatPercent: number;
  validFrom: string;
  validTo: string | null;
}

export interface BillingInput {
  /** Edellinen lukemapäivä, esim. 2025-09-30. Ei kuulu jaksoon. */
  periodStart: string;
  /** Jakson viimeinen päivä ja lukemapäivä, esim. 2026-03-31. */
  periodEnd: string;
  areaId: string | null;
  connections: BillingConnection[];
  meters: BillingMeter[];
  tariffs: BillingTariff[];
  /** Kuinka monen päivän päähän jakson lopusta lukema kelpaa (ilmoitukset tulevat viiveellä). */
  readingWindowDays?: number;
}

export interface BillingLine {
  kind: "usage" | "basic_fee";
  connectionKind: ConnectionKind;
  description: string;
  quantity: number;
  unit: "m3" | "month";
  unitPrice: number;
  vatPercent: number;
  net: number;
}

export interface MeterUsage {
  meterId: string;
  connectionKind: ConnectionKind;
  from: { readOn: string; reading: number } | null;
  to: { readOn: string; reading: number } | null;
  m3: number;
}

export interface BillingResult {
  lines: BillingLine[];
  usage: MeterUsage[];
  waterM3: number;
  wastewaterM3: number;
  net: number;
  vat: number;
  gross: number;
  /** Laskentaa estävät tai tarkistusta vaativat asiat. */
  issues: string[];
}

const DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const addDays = (iso: string, n: number) => fromDay(toDay(iso) + n);

/** Kuukausien alkupäivät jaksossa (start, end]: jakso 30.9.–31.3. → loka–maalis. */
export function billingMonths(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${addDays(start, 1)}T00:00:00Z`);
  const y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  // Kuukausi lasketaan, jos se alkaa jakson sisällä tai jakso alkaa kuun ensimmäisenä.
  if (s.getUTCDate() !== 1) m += 1;
  for (;;) {
    const first = fromDay(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1) / DAY);
    if (first > end) break;
    out.push(first);
    m += 1;
  }
  // Jakso 30.9.–31.3.: 1.10. on jakson ensimmäinen päivä → mukana. Ylimääräistä kuukautta ei synny.
  return out;
}

function tariffFor(
  tariffs: BillingTariff[],
  chargeType: BillingTariff["chargeType"],
  kind: ConnectionKind,
  date: string,
  areaId: string | null,
  feeClass: string | null,
): BillingTariff | null {
  const valid = tariffs.filter(
    (t) =>
      t.chargeType === chargeType &&
      (t.connectionKind === null || t.connectionKind === kind) &&
      t.validFrom <= date &&
      (t.validTo === null || t.validTo >= date) &&
      (chargeType !== "basic_fee" || t.feeClass === feeClass),
  );
  // Aluekohtainen hinta voittaa koko organisaation hinnan.
  return valid.find((t) => areaId && t.areaId === areaId) ?? valid.find((t) => t.areaId === null) ?? null;
}

/** Mittarin kulutus jaksolta: jakson loppua lähin lukema ja sitä edeltävä. */
export function meterUsage(meter: BillingMeter, start: string, end: string, windowDays = 60): { from: BillingReading | null; to: BillingReading | null; m3: number } | null {
  if (meter.removedOn && meter.removedOn <= start) return null;
  if (meter.installedOn > end) return null;
  const points: BillingReading[] = [
    { readOn: meter.installedOn, reading: meter.startReading },
    ...[...meter.readings].sort((a, b) => a.readOn.localeCompare(b.readOn)),
  ];
  if (meter.removedOn && meter.finalReading !== null && !points.some((p) => p.readOn === meter.removedOn)) {
    points.push({ readOn: meter.removedOn, reading: meter.finalReading });
  }
  const limit = addDays(end, windowDays);
  const inWindow = points.filter((p, i) => i > 0 && p.readOn > start && p.readOn <= limit);
  const to = inWindow.at(-1) ?? null;
  if (!to) return { from: null, to: null, m3: 0 };
  const idx = points.indexOf(to);
  const from = points[idx - 1] ?? null;
  if (!from) return { from: null, to, m3: 0 };
  return { from, to, m3: round3((to.reading - from.reading) * meter.multiplier) };
}

export function calculateBill(input: BillingInput): BillingResult {
  const { periodStart: start, periodEnd: end, areaId } = input;
  const issues: string[] = [];
  const lines: BillingLine[] = [];
  const usage: MeterUsage[] = [];
  const connById = new Map(input.connections.map((c) => [c.id, c]));
  const active = (c: BillingConnection) => c.connectedOn <= end && (c.disconnectedOn === null || c.disconnectedOn > start);
  const water = input.connections.find((c) => c.kind === "water" && active(c)) ?? null;
  const waste = input.connections.find((c) => c.kind === "wastewater" && active(c)) ?? null;

  // --- Kulutus ---
  let metered = 0;
  const measuringKind: ConnectionKind | null = water ? "water" : waste ? "wastewater" : null;
  for (const m of input.meters) {
    const conn = connById.get(m.connectionId);
    if (!conn || conn.kind !== measuringKind) continue;
    const u = meterUsage(m, start, end, input.readingWindowDays);
    if (!u) continue;
    if (!u.to) issues.push(`Mittarilta puuttuu lukema jakson lopusta (${m.id}).`);
    if (u.m3 < 0) issues.push(`Negatiivinen kulutus mittarilla ${m.id}.`);
    usage.push({ meterId: m.id, connectionKind: conn.kind, from: u.from, to: u.to, m3: u.m3 });
    metered += u.m3;
  }
  if (measuringKind && usage.length === 0) issues.push("Kiinteistöllä ei ole mittaria jaksolla.");
  const waterM3 = water ? round3(metered) : 0;
  const wastewaterM3 = waste ? round3(metered) : 0;

  // Käyttömaksu: jaetaan päivien suhteessa, jos hinta muuttuu kesken jakson.
  const days = toDay(end) - toDay(start);
  const usageLines = (kind: ConnectionKind, m3: number, label: string) => {
    if (m3 === 0 && days > 0) return;
    const parts = new Map<string, { t: BillingTariff; days: number }>();
    for (let d = toDay(start) + 1; d <= toDay(end); d++) {
      const t = tariffFor(input.tariffs, "usage_fee", kind, fromDay(d), areaId, null);
      if (!t) {
        issues.push(`Käyttömaksun hinta puuttuu: ${label}, ${fromDay(d)}.`);
        return;
      }
      const key = `${t.priceEur}|${t.vatPercent}`;
      parts.set(key, { t, days: (parts.get(key)?.days ?? 0) + 1 });
    }
    let left = m3;
    const entries = [...parts.values()];
    entries.forEach((p, i) => {
      const q = i === entries.length - 1 ? round3(left) : round3((m3 * p.days) / days);
      left -= q;
      lines.push({ kind: "usage", connectionKind: kind, description: label, quantity: q, unit: "m3", unitPrice: p.t.priceEur, vatPercent: p.t.vatPercent, net: round2(q * p.t.priceEur) });
    });
  };
  if (water) usageLines("water", waterM3, "Vesi");
  if (waste) usageLines("wastewater", wastewaterM3, "Jätevesi");

  // --- Perusmaksut kuukausittain ---
  for (const c of [water, waste]) {
    if (!c) continue;
    const label = c.kind === "water" ? "Veden perusmaksu" : "Jätevesi perusmaksu";
    if (!c.feeClass) {
      issues.push(`${label}: liittymän perusmaksuluokka puuttuu.`);
      continue;
    }
    const months = billingMonths(start, end).filter((first) => c.connectedOn < addDays(first, 1) && (c.disconnectedOn === null || c.disconnectedOn >= first));
    const groups = new Map<string, { t: BillingTariff; n: number }>();
    for (const first of months) {
      const t = tariffFor(input.tariffs, "basic_fee", c.kind, first, areaId, c.feeClass);
      if (!t) {
        issues.push(`${label}: hinta puuttuu luokalle ${c.feeClass} (${first}).`);
        continue;
      }
      const key = `${t.priceEur}|${t.vatPercent}`;
      groups.set(key, { t, n: (groups.get(key)?.n ?? 0) + 1 });
    }
    for (const g of groups.values()) {
      lines.push({ kind: "basic_fee", connectionKind: c.kind, description: label, quantity: g.n, unit: "month", unitPrice: g.t.priceEur, vatPercent: g.t.vatPercent, net: round2(g.n * g.t.priceEur) });
    }
  }

  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat = round2(lines.reduce((s, l) => s + (l.net * l.vatPercent) / 100, 0));
  return { lines, usage, waterM3, wastewaterM3, net, vat, gross: round2(net + vat), issues };
}
