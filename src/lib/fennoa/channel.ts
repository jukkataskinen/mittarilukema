/**
 * Laskukanava. Kanava on asiakkaan nimenomaisesti asetettu tieto, eikä sille
 * ole oletusta: puuttuva tai puutteellinen kanava estää viennin, jottei lasku
 * lähde paperina sille, jolle on luvattu sähköposti tai e-lasku.
 */

export const INVOICE_CHANNELS = ["paper", "email", "einvoice", "consumer_einvoice", "direct_payment"] as const;
export type InvoiceChannel = (typeof INVOICE_CHANNELS)[number];

export const CHANNEL_LABEL: Record<InvoiceChannel, string> = {
  paper: "Paperilasku postitse",
  email: "Sähköposti",
  einvoice: "Verkkolasku (yritys)",
  consumer_einvoice: "E-lasku verkkopankkiin",
  direct_payment: "Suoramaksu",
};

/** Fennoan delivery_method (tietopankki.fennoa.com/api-sales-invoices). */
export const FENNOA_DELIVERY: Record<InvoiceChannel, string> = {
  paper: "postal",
  email: "email",
  einvoice: "finvoice",
  consumer_einvoice: "consumerfinvoice",
  direct_payment: "consumerdirect",
};

export interface ChannelCustomer {
  kind: "person" | "company";
  name: string | null;
  email: string | null;
  invoice_channel: string | null;
  einvoice_address: string | null;
  einvoice_operator: string | null;
  billing_street: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
const BIC = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const OVT = /^0037\d{8,13}$/;

export function isInvoiceChannel(v: unknown): v is InvoiceChannel {
  return typeof v === "string" && (INVOICE_CHANNELS as readonly string[]).includes(v);
}

/**
 * Kanavan edellyttämät tiedot. Palauttaa puutteet käyttäjälle näytettävinä
 * lauseina ilman henkilötietoja. Tyhjä lista = lasku voidaan viedä.
 * Fennoa vaatii laskulle aina postiosoitteen, myös sähköiselle laskulle.
 */
export function channelProblems(c: ChannelCustomer, opts: { address?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!c.name?.trim()) problems.push("Asiakkaan nimi puuttuu.");
  if (opts.address !== false && (!c.billing_street?.trim() || !/^\d{5}$/.test(c.billing_postal_code ?? "") || !c.billing_city?.trim())) {
    problems.push("Laskutusosoite puuttuu tai on puutteellinen.");
  }
  if (!c.invoice_channel) {
    problems.push("Laskukanava puuttuu. Aseta se asiakkaalle ennen vientiä.");
    return problems;
  }
  if (!isInvoiceChannel(c.invoice_channel)) {
    problems.push("Tuntematon laskukanava.");
    return problems;
  }
  const address = (c.einvoice_address ?? "").replace(/\s/g, "").toUpperCase();
  const operator = (c.einvoice_operator ?? "").replace(/\s/g, "").toUpperCase();
  switch (c.invoice_channel) {
    case "email":
      if (!c.email || !EMAIL.test(c.email)) problems.push("Sähköpostilasku: asiakkaan sähköpostiosoite puuttuu tai on virheellinen.");
      break;
    case "einvoice":
      if (!OVT.test(address) && !IBAN.test(address)) problems.push("Verkkolasku: verkkolaskuosoite (OVT) puuttuu tai on virheellinen.");
      if (!operator) problems.push("Verkkolasku: välittäjätunnus puuttuu.");
      break;
    case "consumer_einvoice":
    case "direct_payment": {
      const label = c.invoice_channel === "direct_payment" ? "Suoramaksu" : "E-lasku";
      if (!IBAN.test(address)) problems.push(`${label}: e-laskuosoite (tilinumero) puuttuu tai on virheellinen.`);
      if (!BIC.test(operator)) problems.push(`${label}: pankin välittäjätunnus (BIC) puuttuu tai on virheellinen.`);
      if (c.kind === "company") problems.push(`${label} on kuluttajan kanava, mutta asiakas on yritys. Tarkista kanava.`);
      break;
    }
  }
  return problems;
}

/**
 * Kanava vanhan järjestelmän verkkolaskuosoitteesta: tilinumero ja BIC =
 * kuluttajan e-lasku, OVT = yrityksen verkkolasku, suoramaksusopimus =
 * suoramaksu. Muuten ei kanavaa (ei arvata paperia eikä sähköpostia).
 */
export function channelFromEinvoice(address: string | null, operator: string | null, directPayment: boolean): InvoiceChannel | null {
  const a = (address ?? "").replace(/\s/g, "").toUpperCase();
  const o = (operator ?? "").replace(/\s/g, "").toUpperCase();
  if (IBAN.test(a) && BIC.test(o)) return directPayment ? "direct_payment" : "consumer_einvoice";
  if (OVT.test(a) && o) return "einvoice";
  return null;
}
