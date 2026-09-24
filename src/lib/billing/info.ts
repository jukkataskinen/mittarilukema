import type { MeterUsage } from "./calculate";

/**
 * Laskun lisätieto: kulutuksen peruste mittareittain samassa muodossa kuin
 * Joutsan nykyisillä Fennoa-laskuilla, jotta asiakas näkee tutun rivin:
 *
 *   Edellinen lukema 5657 m3, 30.9.2025 - 31.3.2026: 5710 m3, Unes: 71030 / Leivonmäentie 23
 *
 * Mittarinumero lisätään alkuun, kun se tiedetään, ja teollisuusmittarin
 * kerroin loppuun. Mittarinvaihdossa kumpikin mittari on omalla rivillään.
 */

const num = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
const date = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};

export interface InfoMeter {
  id: string;
  meterNumber?: string | null;
  multiplier: number;
}

export function invoiceInfo(input: {
  usage: MeterUsage[];
  meters: InfoMeter[];
  legacyId: string | null;
  address: string;
  /** Mittarittoman kiinteistön teksti, kun kulutus on sovittu. */
  noMeterText?: string | null;
}): string {
  const place = input.legacyId ? `Unes: ${input.legacyId} / ${input.address}` : input.address;
  const lines = input.usage
    .filter((u) => u.from && u.to)
    .map((u) => {
      const m = input.meters.find((x) => x.id === u.meterId);
      const prefix = m?.meterNumber ? `Mittari ${m.meterNumber}: e` : "E";
      const factor = m && m.multiplier !== 1 ? `, kerroin ${num(m.multiplier)}, kulutus ${num(u.m3)} m3` : "";
      return `${prefix}dellinen lukema ${num(u.from!.reading)} m3, ${date(u.from!.readOn)} - ${date(u.to!.readOn)}: ${num(u.to!.reading)} m3${factor}, ${place}`;
    });
  if (lines.length === 0 && input.noMeterText) lines.push(`${input.noMeterText}, ${place}`);
  return lines.join("\n");
}
