/**
 * Fennoan tuotelistan vienti (CSV, puolipiste): Koodi; Nimi suomeksi; …;
 * Oletusmyyntihinta; …; Yksikkö suomeksi; …; ALV; Tili; Tuoteryhmät; Kustannuspaikka.
 * Ensimmäinen rivi on yrityksen nimi, toinen otsikot. Tiedosto on
 * Windows-1252-merkistöä, joten se luetaan tavuina ja puretaan tarvittaessa.
 */

export interface FennoaProductRow {
  code: string;
  name: string;
  unit: string | null;
  price: number | null;
  vatPercent: number | null;
  account: string | null;
  costCenter: { code: string; name: string } | null;
}

export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const num = (v: string | undefined) => {
  const s = (v ?? "").trim().replace(",", ".");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function parseFennoaProducts(text: string): FennoaProductRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^koodi;/i.test(l.trim()));
  if (headerIdx < 0) throw new Error("Tiedostosta puuttuu otsikkorivi (Koodi;Nimi suomeksi;…).");
  const header = lines[headerIdx].split(";").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const idx = {
    code: col("koodi"), name: col("nimi suomeksi"), price: col("oletusmyyntihinta"), unit: col("yksikk"), vat: col("alv"), account: col("tili"),
    costCenter: col("kustannuspaikka"),
  };
  if (idx.code < 0 || idx.name < 0) throw new Error("Tiedostosta puuttuu Koodi tai Nimi suomeksi.");
  const out: FennoaProductRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const c = line.split(";");
    const code = (c[idx.code] ?? "").trim();
    if (!code) continue;
    const cc = (c[idx.costCenter] ?? "").trim();
    const m = /^(\S+)\s*-\s*(.+)$/.exec(cc);
    out.push({
      code,
      name: (c[idx.name] ?? "").trim(),
      unit: (c[idx.unit] ?? "").trim().replace(/\s+$/, "") || null,
      price: num(c[idx.price]),
      vatPercent: num(c[idx.vat]),
      account: (c[idx.account] ?? "").trim() || null,
      costCenter: m ? { code: m[1], name: m[2].trim() } : cc ? { code: cc, name: cc } : null,
    });
  }
  return out;
}

export interface FennoaCostCenterRow {
  code: string;
  name: string;
  description: string | null;
  active: boolean;
}

/** Fennoan laskentakohteet (Kustannuspaikka laskentakohteet): Koodi; Nimi; Selite; Aktiivinen; … */
export function parseFennoaCostCenters(text: string): FennoaCostCenterRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^koodi;nimi/i.test(l.trim()));
  if (headerIdx < 0) throw new Error("Tiedostosta puuttuu otsikkorivi (Koodi;Nimi;…).");
  const header = lines[headerIdx].split(";").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const i = { code: col("koodi"), name: col("nimi"), description: col("selite"), active: col("aktiivinen") };
  return lines
    .slice(headerIdx + 1)
    .map((l) => l.split(";"))
    .filter((c) => (c[i.code] ?? "").trim())
    .map((c) => ({
      code: c[i.code].trim(),
      name: (c[i.name] ?? "").trim(),
      description: (c[i.description] ?? "").trim() || null,
      active: i.active < 0 || !/^ei$/i.test((c[i.active] ?? "").trim()),
    }));
}
