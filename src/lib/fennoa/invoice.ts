import { channelProblems, FENNOA_DELIVERY, type ChannelCustomer, type InvoiceChannel } from "./channel";

/**
 * Mittarilukeman lasku Fennoan sales_api/add-kentiksi (lomakedata).
 * Kentät: tietopankki.fennoa.com/api-sales-invoices ja Kasamasterin toimiva
 * toteutus. Laskukanava asetetaan laskulle aina itse (delivery_method), eikä
 * luoteta Fennoan asiakaskortin oletukseen.
 */

export interface ExportLine {
  description: string;
  quantity: number;
  unit: "m3" | "month" | "year";
  unit_price: number;
  vat_percent: number;
  net_eur: number;
  vat_eur: number | null;
  price_includes_vat: boolean;
  /** Tuoterekisteristä (0024): tuotekoodi, kirjanpitotili ja laskentakohde. */
  product_code?: string | null;
  account_code?: string | null;
  cost_center_code?: string | null;
}

export interface ExportInvoice {
  customer: ChannelCustomer & { customer_number: string | null; fennoa_customer_id: string | null; phone: string | null };
  info: string | null;
  gross_eur: number;
  period_start: string;
  period_end: string;
  lines: ExportLine[];
}

const UNIT: Record<ExportLine["unit"], string> = { m3: "m³", month: "kk", year: "v" };
const NOTES_MAX = 500;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export type BuildResult =
  | { ok: true; form: Record<string, string>; channel: InvoiceChannel; deliveryMethod: string }
  | { ok: false; problems: string[] };

export function buildFennoaInvoice(inv: ExportInvoice, opts: { invoiceDate: string; dueDate: string; costCenterDim?: string | null }): BuildResult {
  const c = inv.customer;
  const problems = channelProblems(c);
  if (!inv.lines.length) problems.push("Laskulla ei ole rivejä.");
  if ((inv.info ?? "").length > NOTES_MAX) problems.push(`Laskun lisätieto on yli ${NOTES_MAX} merkkiä, mikä on Fennoan raja.`);

  // Fennoan include_vat koskee koko laskua: verollisia ja verottomia verollisia rivejä ei voi sekoittaa.
  const gross = inv.lines.some((l) => l.price_includes_vat);
  if (gross && inv.lines.some((l) => !l.price_includes_vat && l.vat_percent > 0)) {
    problems.push("Laskulla on sekä verollisia että verottomia hintoja, joita Fennoa ei käsittele samalla laskulla.");
  }
  if (problems.length) return { ok: false, problems };

  const channel = c.invoice_channel as InvoiceChannel;
  const deliveryMethod = FENNOA_DELIVERY[channel];
  const form: Record<string, string> = {
    customer_no: c.fennoa_customer_id ?? c.customer_number ?? "",
    account_type_id: c.kind === "company" ? "1" : "2",
    name: c.name ?? "",
    address: c.billing_street ?? "",
    postalcode: c.billing_postal_code ?? "",
    city: c.billing_city ?? "",
    country: "FI",
    email: c.email ?? "",
    phone: c.phone ?? "",
    invoice_date: opts.invoiceDate,
    due_date: opts.dueDate,
    locale: "fi",
    delivery_method: deliveryMethod,
    delivery_period_start: addDay(inv.period_start),
    delivery_period_end: inv.period_end,
    notes_before: inv.info ?? "",
  };
  if (gross) form.include_vat = "1";
  // Hyvitys (esim. tasaus, jossa arvioita on laskutettu liikaa) hyvityslaskuna.
  if (inv.gross_eur < 0) form.invoice_type_id = "2";

  // Kanavan osoitetiedot. Sähköposti menee einvoice_address-kenttään, verkko- ja e-lasku osoite ja välittäjä.
  if (channel === "email") {
    form.einvoice_address = c.email ?? "";
  } else if (channel !== "paper") {
    form.einvoice_address = (c.einvoice_address ?? "").replace(/\s/g, "").toUpperCase();
    form.einvoice_operator = (c.einvoice_operator ?? "").replace(/\s/g, "").toUpperCase();
  }

  // Rivit alkavat ykkösestä. Hinta verollisena, jos lasku on verollinen (include_vat).
  inv.lines.forEach((l, i) => {
    const n = i + 1;
    const amount = round2(l.price_includes_vat ? l.net_eur + (l.vat_eur ?? 0) : l.net_eur);
    let quantity = l.quantity;
    let price = l.unit_price;
    let unit = UNIT[l.unit];
    let name = l.description;
    // Fennoa laskee rivin summan määrä × hinta. Jos hinta ei ole tarkka (esim. tasauksen
    // vähennys, joka on laskutettu euromäärä), rivi viedään yhtenä eränä, jotta summa täsmää.
    if (Math.abs(round2(round4(price) * quantity) - amount) >= 0.005) {
      name = `${l.description} (${String(l.quantity).replace(".", ",")} ${UNIT[l.unit]})`;
      quantity = 1;
      price = amount;
      unit = "erä";
    }
    form[`row[${n}][name]`] = name;
    form[`row[${n}][quantity]`] = String(quantity);
    form[`row[${n}][unit]`] = unit;
    form[`row[${n}][price]`] = String(round4(price));
    form[`row[${n}][vatpercent]`] = String(l.vat_percent);
    // Tuotekoodi ja tili kirjanpitoon. Fennoa ottaa tilin vain tuotteelliselta riviltä.
    if (l.product_code) {
      form[`row[${n}][product_no]`] = l.product_code;
      if (l.account_code) form[`row[${n}][account_code]`] = l.account_code;
    }
    if (l.cost_center_code && opts.costCenterDim && /^dim\d+$/.test(opts.costCenterDim)) {
      form[`row[${n}][dim][${opts.costCenterDim}]`] = l.cost_center_code;
    }
  });
  return { ok: true, form, channel, deliveryMethod };
}
