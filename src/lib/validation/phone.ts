/**
 * Puhelinnumero kansainväliseen muotoon (+358...). Tekstiviestilukema
 * yhdistetään asiakkaaseen lähettäjän numerolla, joten kannassa on vain yksi muoto.
 * Palauttaa null, jos numeroa ei voi tulkita.
 */
export function normalizePhone(value: string): string | null {
  const v = value.replace(/[\s\-()]/g, "");
  if (/^\+\d{7,15}$/.test(v)) return v;
  if (/^00\d{7,15}$/.test(v)) return `+${v.slice(2)}`;
  if (/^0\d{6,12}$/.test(v)) return `+358${v.slice(1)}`;
  return null;
}

/** Näyttömuoto: +358 40 123 4567 → 040 123 4567 kotimaisille numeroille. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "–";
  if (value.startsWith("+358")) {
    const local = `0${value.slice(4)}`;
    return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
  }
  return value;
}
