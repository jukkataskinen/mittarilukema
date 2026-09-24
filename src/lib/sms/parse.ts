import { parseReading } from "@/lib/readings/checks";

/**
 * Tekstiviestin tulkinta. Asiakkaat kirjoittavat vapaasti: "1234",
 * "1234,5", "Lukema 1234 m3", "Kivitie 8: 1234", tai käyttöpaikan tunnus
 * ja lukema "40960 1234". Tulkitaan varovasti: jos viestistä ei saa yhtä
 * selvää lukemaa, se jää toimiston käsiteltäväksi.
 */

export interface ParsedSms {
  reading: number | null;
  /** Käyttöpaikan tunnus (Unes), jos viestissä on viisinumeroinen luku lukeman lisäksi. */
  placeId: string | null;
  /** Syy, jos lukemaa ei tulkittu. */
  problem: string | null;
}

export function parseSms(body: string): ParsedSms {
  const text = body
    .replace(/ /g, " ")
    // Pvm (25.9. tai 25.9.2026) pois, jottei sitä luulla lukemaksi.
    .replace(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})?(?!\d)/g, " ")
    .replace(/\bm3\b|\bm³\b|kuutiota?/gi, " ");
  let numbers = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
  // Välilyönti tuhaterottimena ("1 234") vain, kun viestissä on juuri kaksi lukua ja
  // jälkimmäinen on kolminumeroinen. Muuten ensimmäinen on talonumero ("Kivitie 8 1264").
  if (numbers.length === 2 && /^\d{1,3}$/.test(numbers[0]) && /^\d{3}([.,]\d+)?$/.test(numbers[1]) && text.includes(`${numbers[0]} ${numbers[1]}`)) {
    numbers = [numbers[0] + numbers[1]];
  }
  if (numbers.length === 0) return { reading: null, placeId: null, problem: "Viestissä ei ole lukemaa." };
  if (numbers.length === 1) {
    const r = parseReading(numbers[0]);
    return r === null ? { reading: null, placeId: null, problem: "Lukemaa ei voitu tulkita." } : { reading: r, placeId: null, problem: null };
  }
  if (numbers.length === 2 && /^\d{5}$/.test(numbers[0])) {
    const r = parseReading(numbers[1]);
    if (r !== null) return { reading: r, placeId: numbers[0], problem: null };
  }
  // Osoitteen talonumero ("Kivitie 8 1234"): viimeinen luku on lukema, jos muut ovat lyhyitä.
  const last = numbers[numbers.length - 1];
  if (numbers.slice(0, -1).every((n) => /^\d{1,3}$/.test(n)) && /^\d{3,}/.test(last)) {
    const r = parseReading(last);
    if (r !== null) return { reading: r, placeId: null, problem: null };
  }
  return { reading: null, placeId: null, problem: "Viestissä on useita lukuja." };
}
