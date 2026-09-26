import { describe, expect, it } from "vitest";
import type { BillingLine } from "@/lib/billing/calculate";
import { decodeCsv, parseFennoaProducts } from "@/lib/products/fennoa-csv";
import { joutsaRule } from "@/lib/products/joutsa";
import { resolveProduct, type Product } from "@/lib/products";
import { buildFennoaInvoice } from "@/lib/fennoa/invoice";

const CSV = [
  "Joutsan Vesihuolto Oy;Tuotteet",
  "Koodi;Nimi suomeksi;Nimi englanniksi;Nimi ruotsiksi;Selite;Hankintahinta;Oletusmyyntihinta;Hinta sis. ALV;Yksikkö suomeksi;Yksikkö englanniksi;Yksikkö ruotsiksi;ALV;Tili;Tuoteryhmät;Kustannuspaikka",
  "1000;Veden perusmaksu Joutsa;;;;0;3.67;0;kk;;;25,5;3020;;1 - Puhdasvesi",
  "3954;Huomautusmaksu;;;;0;5;0;kpl;;;-;3954;;",
  "",
].join("\r\n");

describe("Fennoan tuotelista", () => {
  it("tuotteet, tili ja laskentakohde", () => {
    expect(parseFennoaProducts(CSV)).toEqual([
      { code: "1000", name: "Veden perusmaksu Joutsa", unit: "kk", price: 3.67, vatPercent: 25.5, account: "3020", costCenter: { code: "1", name: "Puhdasvesi" } },
      { code: "3954", name: "Huomautusmaksu", unit: "kpl", price: 5, vatPercent: null, account: "3954", costCenter: null },
    ]);
  });
  it("Windows-1252-merkistö", () => {
    const bytes = new Uint8Array([0x4a, 0xe4, 0x74, 0x65]); // "Jäte" Windows-1252:na
    expect(decodeCsv(bytes)).toBe("Jäte");
  });
});

describe("Joutsan säännöt tuotenimestä", () => {
  it.each([
    ["Veden perusmaksu Joutsa", { autoMatch: true, chargeType: "basic_fee", connectionKind: "water", feeClass: "okt", areaName: null, customerGroup: null, metered: null }],
    ["Jäteveden perusmaksu DN 32 kunta", { autoMatch: true, chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "dn32", areaName: null, customerGroup: "kunta", metered: null }],
    ["Veden kulutus Joutsa", { autoMatch: true, chargeType: "usage_fee", connectionKind: "water", feeClass: null, areaName: null, customerGroup: null, metered: null }],
    ["Jäteveden perusmaksu, ei mittaria Rutalahti", { autoMatch: true, chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", areaName: "Rutalahti", customerGroup: null, metered: false }],
    ["Jäteveden perusmaksu kunta/Rutalahti", { autoMatch: true, chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", areaName: "Rutalahti", customerGroup: "kunta", metered: null }],
  ])("%s", (name, rule) => expect(joutsaRule(name)).toEqual(rule));
  it("Leivonmäki, hyvitykset ja palvelut käsin", () => {
    expect(joutsaRule("Veden perusmaksu Leivonmäki").autoMatch).toBe(false);
    expect(joutsaRule("Hyvitys vesi Joutsa").autoMatch).toBe(false);
    expect(joutsaRule("Työveloitus, kunta").autoMatch).toBe(false);
  });
});

const product = (code: string, match: Partial<Product["match"]>): Product => ({
  id: `id-${code}`, code, name: code, accountCode: `A${code}`, costCenterCode: "1", autoMatch: true, active: true,
  match: { chargeType: null, connectionKind: null, feeClass: null, areaId: null, customerGroup: null, metered: null, ...match },
});
const PRODUCTS = [
  product("1000", { chargeType: "basic_fee", connectionKind: "water", feeClass: "okt" }),
  product("1020", { chargeType: "basic_fee", connectionKind: "water", feeClass: "dn20" }),
  product("1110", { chargeType: "basic_fee", connectionKind: "water", feeClass: "okt", customerGroup: "kunta" }),
  product("1010", { chargeType: "usage_fee", connectionKind: "water" }),
  product("1311", { chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", areaId: "ruta" }),
  product("1432", { chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", areaId: "ruta", metered: false }),
];
const line = (kind: BillingLine["kind"], connectionKind: BillingLine["connectionKind"], feeClass: string | null = null): BillingLine => ({
  kind, connectionKind, description: "", quantity: 1, unit: "month", unitPrice: 1, vatPercent: 25.5, net: 1, vat: 0.26, priceIncludesVat: false, feeClass,
});
const ctx = { areaId: null, customerGroup: null, metered: true };

describe("tuotteen valinta laskuriville", () => {
  it("perusmaksuluokka ja liittymälaji", () => {
    expect(resolveProduct(PRODUCTS, line("basic_fee", "water", "dn20"), ctx)?.code).toBe("1020");
    expect(resolveProduct(PRODUCTS, line("usage", "water"), ctx)?.code).toBe("1010");
  });
  it("tarkempi sääntö voittaa: kunta ja Rutalahti ilman mittaria", () => {
    expect(resolveProduct(PRODUCTS, line("basic_fee", "water", "okt"), { ...ctx, customerGroup: "Kunta" })?.code).toBe("1110");
    expect(resolveProduct(PRODUCTS, line("basic_fee", "wastewater", "okt"), { ...ctx, areaId: "ruta" })?.code).toBe("1311");
    expect(resolveProduct(PRODUCTS, line("basic_fee", "wastewater", "okt"), { ...ctx, areaId: "ruta", metered: false })?.code).toBe("1432");
  });
  it("ei sopivaa tuotetta", () => expect(resolveProduct(PRODUCTS, line("basic_fee", "wastewater", "okt"), ctx)).toBeNull());
  it("kiinteistön maksu osoittaa suoraan tuotteeseen", () => {
    expect(resolveProduct(PRODUCTS, { ...line("other_fee", null), productId: "id-1010" }, ctx)?.code).toBe("1010");
  });
});

describe("Fennoa-rivi", () => {
  it("tuotekoodi, tili ja laskentakohde", () => {
    const r = buildFennoaInvoice(
      {
        customer: {
          kind: "person", name: "Testi", email: null, phone: null, invoice_channel: "paper", einvoice_address: null, einvoice_operator: null,
          billing_street: "Tie 1", billing_postal_code: "19650", billing_city: "Joutsa", customer_number: "1", fennoa_customer_id: null,
        },
        info: null, gross_eur: 4.61, period_start: "2026-08-31", period_end: "2026-09-30",
        lines: [{ description: "Veden perusmaksu", quantity: 1, unit: "month", unit_price: 3.67, vat_percent: 25.5, net_eur: 3.67, vat_eur: 0.94, price_includes_vat: false,
          product_code: "1000", account_code: "3020", cost_center_code: "1" }],
      },
      { invoiceDate: "2026-10-01", dueDate: "2026-10-15", costCenterDim: "dim1" },
    );
    expect(r.ok && [r.form["row[1][product_no]"], r.form["row[1][account_code]"], r.form["row[1][dim][dim1]"]]).toEqual(["1000", "3020", "1"]);
  });
});
