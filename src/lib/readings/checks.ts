/**
 * Mittarilukeman järkevyystarkistukset (eRapun mallin pohjalta).
 *
 * Poikkeava lukema ei ole virhe: mittari on voitu vaihtaa, kiinteistö on
 * tyhjillään tai putkessa on vuoto. Se jää kuitenkin tarkistettavaksi eikä
 * mene laskulle ennen hyväksyntää. Pientä kulutusta ei merkitä, koska
 * vapaa-ajan asunnoilla se on tavallista.
 */

/** Kulutus yli tämän (m³) edellisestä lukemasta on aina tarkistettava. */
export const LARGE_CONSUMPTION_M3 = 300;
/** Päiväkulutus yli tämän kertoimen edellisen jakson tasoon verrattuna on piikki. */
export const SPIKE_FACTOR = 3;
/** Piikkiä ei merkitä, jos kulutus on alle tämän (m³); pienet määrät vaihtelevat luonnostaan. */
export const SPIKE_MIN_M3 = 20;

export type ReadingIssue = "lower" | "large" | "spike";

export interface PreviousReading {
  reading: number;
  readOn: string;
}

const DAY = 24 * 60 * 60 * 1000;
const days = (from: string, to: string) => Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY));

/** Lukema tekstistä: välilyönnit pois, pilkku pisteeksi, enintään kolme desimaalia. */
export function parseReading(value: string): number | null {
  const t = value.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(t)) return null;
  return Number(t);
}

/**
 * @param previous viimeisin hyväksytty lukema ennen uutta
 * @param beforePrevious sitä edeltävä lukema, josta lasketaan jakson normaali päiväkulutus
 */
export function readingIssues(
  value: number,
  readOn: string,
  previous: PreviousReading | null,
  beforePrevious: PreviousReading | null = null,
): ReadingIssue[] {
  if (!previous) return [];
  const diff = value - previous.reading;
  if (diff < 0) return ["lower"];
  if (diff > LARGE_CONSUMPTION_M3) return ["large"];
  if (beforePrevious && diff >= SPIKE_MIN_M3) {
    const normal = (previous.reading - beforePrevious.reading) / days(beforePrevious.readOn, previous.readOn);
    const now = diff / days(previous.readOn, readOn);
    if (normal > 0 && now > normal * SPIKE_FACTOR) return ["spike"];
  }
  return [];
}

export const ISSUE_LABEL: Record<ReadingIssue, string> = {
  lower: "Pienempi kuin edellinen",
  large: "Poikkeuksellisen suuri kulutus",
  spike: "Kulutus moninkertainen aiempaan",
};
