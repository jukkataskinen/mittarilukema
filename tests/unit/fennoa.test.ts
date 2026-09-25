import { describe, expect, it } from "vitest";
import { channelFromEinvoice, channelProblems, FENNOA_DELIVERY, INVOICE_CHANNELS, type ChannelCustomer } from "@/lib/fennoa/channel";
import { buildFennoaInvoice, type ExportInvoice } from "@/lib/fennoa/invoice";

const person: ChannelCustomer = {
  kind: "person", name: "Testi Asiakas", email: "testi@example.fi", invoice_channel: "email",
  einvoice_address: null, einvoice_operator: null, billing_street: "Testitie 1", billing_postal_code: "41800", billing_city: "Korpilahti",
};

const invoice = (over: Partial<ExportInvoice["customer"]> = {}, rest: Partial<ExportInvoice> = {}): ExportInvoice => ({
  customer: { ...person, customer_number: "12", fennoa_customer_id: null, phone: null, ...over },
  info: "Arviolasku 1.10.2026 - 31.10.2026",
  gross_eur: 63.06,
  period_start: "2026-09-30",
  period_end: "2026-10-31",
  lines: [
    { description: "Vesi, arvio", quantity: 2, unit: "m3", unit_price: 2.57, vat_percent: 25.5, net_eur: 4.1, vat_eur: 1.04, price_includes_vat: true },
    { description: "Jätevesi, arvio", quantity: 2, unit: "m3", unit_price: 3.28, vat_percent: 25.5, net_eur: 5.23, vat_eur: 1.33, price_includes_vat: true },
    { description: "Perusmaksu", quantity: 1, unit: "month", unit_price: 51.36, vat_percent: 25.5, net_eur: 40.92, vat_eur: 10.44, price_includes_vat: true },
  ],
  ...rest,
});
const opts = { invoiceDate: "2026-10-01", dueDate: "2026-10-15" };

describe("laskukanava", () => {
  it("jokaisella kanavalla on oma Fennoan toimitustapa, eikä mikään ole paperi oletuksena", () => {
    expect(INVOICE_CHANNELS.map((c) => FENNOA_DELIVERY[c])).toEqual(["postal", "email", "finvoice", "consumerfinvoice", "consumerdirect"]);
  });

  it("puuttuva kanava estää viennin", () => {
    expect(channelProblems({ ...person, invoice_channel: null })).toEqual(["Laskukanava puuttuu. Aseta se asiakkaalle ennen vientiä."]);
  });

  it("sähköpostilasku ilman sähköpostia estetään (ei vaihdu paperiksi)", () => {
    const r = buildFennoaInvoice(invoice({ email: null }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toMatch(/sähköpostiosoite puuttuu/);
  });

  it("e-lasku vaatii tilinumeron ja pankin BIC-tunnuksen", () => {
    expect(channelProblems({ ...person, invoice_channel: "consumer_einvoice", einvoice_address: "FI08 5922 7795 8512 10", einvoice_operator: "OKOYFIHH" })).toEqual([]);
    expect(channelProblems({ ...person, invoice_channel: "consumer_einvoice", einvoice_address: "FI0859227795851210", einvoice_operator: null }).join()).toMatch(/BIC/);
    expect(channelProblems({ ...person, invoice_channel: "consumer_einvoice", einvoice_address: "003712345678", einvoice_operator: "OKOYFIHH" }).join()).toMatch(/tilinumero/);
  });

  it("verkkolasku vaatii OVT-tunnuksen ja välittäjän", () => {
    expect(channelProblems({ ...person, kind: "company", invoice_channel: "einvoice", einvoice_address: "003712345678", einvoice_operator: "003721291126" })).toEqual([]);
    expect(channelProblems({ ...person, kind: "company", invoice_channel: "einvoice", einvoice_address: "003712345678", einvoice_operator: null }).join()).toMatch(/välittäjä/);
  });

  it("Fennoa vaatii postiosoitteen myös sähköiselle laskulle", () => {
    expect(channelProblems({ ...person, billing_street: null }).join()).toMatch(/Laskutusosoite puuttuu/);
    expect(channelProblems({ ...person, billing_street: null }, { address: false })).toEqual([]);
  });

  it("kanava vanhan järjestelmän verkkolaskuosoitteesta, muuten ei arvata", () => {
    expect(channelFromEinvoice("FI0859227795851210", "OKOYFIHH", false)).toBe("consumer_einvoice");
    expect(channelFromEinvoice("FI0859227795851210", "OKOYFIHH", true)).toBe("direct_payment");
    expect(channelFromEinvoice("003735583672", "003721291126", false)).toBe("einvoice");
    expect(channelFromEinvoice(null, null, false)).toBeNull();
  });
});

describe("lasku Fennoan kentiksi", () => {
  it("sähköpostilasku: toimitustapa ja osoite laskulla, verolliset hinnat", () => {
    const r = buildFennoaInvoice(invoice(), opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form).toMatchObject({
      delivery_method: "email", einvoice_address: "testi@example.fi", account_type_id: "2", include_vat: "1", customer_no: "12",
      invoice_date: "2026-10-01", due_date: "2026-10-15", delivery_period_start: "2026-10-01", delivery_period_end: "2026-10-31",
      "row[1][name]": "Vesi, arvio", "row[1][quantity]": "2", "row[1][unit]": "m³", "row[1][price]": "2.57", "row[1][vatpercent]": "25.5",
      "row[3][name]": "Perusmaksu", "row[3][unit]": "kk", "row[3][price]": "51.36",
    });
    expect(r.form.einvoice_operator).toBeUndefined();
  });

  it("e-lasku: osoite ja BIC välilyönneittä", () => {
    const r = buildFennoaInvoice(invoice({ invoice_channel: "consumer_einvoice", einvoice_address: "fi08 5922 7795 8512 10", einvoice_operator: "okoyfihh" }), opts);
    expect(r.ok && r.form).toMatchObject({ delivery_method: "consumerfinvoice", einvoice_address: "FI0859227795851210", einvoice_operator: "OKOYFIHH" });
  });

  it("paperilasku ei lähetä sähköisen laskun osoitetta", () => {
    const r = buildFennoaInvoice(invoice({ invoice_channel: "paper" }), opts);
    expect(r.ok && r.form.delivery_method).toBe("postal");
    expect(r.ok && r.form.einvoice_address).toBeUndefined();
  });

  it("tasauksen vähennys, jonka hinta ei ole tarkka, viedään yhtenä eränä", () => {
    const r = buildFennoaInvoice(
      invoice({}, {
        gross_eur: -5,
        lines: [{ description: "Vesi arvio", quantity: -250, unit: "m3", unit_price: 2.3458, vat_percent: 25.5, net_eur: -467.28, vat_eur: -119.16, price_includes_vat: true }],
      }),
      opts,
    );
    expect(r.ok && r.form).toMatchObject({ invoice_type_id: "2", "row[1][quantity]": "1", "row[1][unit]": "erä", "row[1][price]": "-586.44", "row[1][name]": "Vesi arvio (-250 m³)" });
  });

  it("liian pitkä lisätieto estää viennin (Fennoan raja 500 merkkiä)", () => {
    const r = buildFennoaInvoice(invoice({}, { info: "x".repeat(501) }), opts);
    expect(r.ok).toBe(false);
  });
});

describe("Fennoan takaisinluku", () => {
  it("poimii toimitustapakentät poikkeaman selvittämiseen ilman osoitteita", async () => {
    const { vi } = await import("vitest");
    const { fennoaClient } = await import("@/lib/fennoa");
    vi.stubEnv("FENNOA_MODE", "test");
    vi.stubEnv("FENNOA_TEST_API_USER", "u");
    vi.stubEnv("FENNOA_TEST_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "OK", data: { SalesInvoice: {
        id: 452, sales_invoice_delivery_method_id: 4, delivery_period_start: "2026-09-01", einvoice_address: "003712345678", einvoice_operator: "", total_gross: "229.64",
      } } }), { status: 200 }),
    ));
    const back = await fennoaClient().getInvoice("452", { einvoiceAddress: "0037 12345678", einvoiceOperator: "003721291126" });
    expect(back).toEqual({
      deliveryMethod: null, gross: 229.64, einvoiceMatch: true,
      deliveryFields: [
        "data.SalesInvoice.sales_invoice_delivery_method_id=4",
        "data.SalesInvoice.einvoice_address: sama kuin lähetetty",
        "data.SalesInvoice.einvoice_operator: tyhjä",
      ],
    });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
