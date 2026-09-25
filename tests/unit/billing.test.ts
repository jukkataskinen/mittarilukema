import { describe, expect, it } from "vitest";
import { billingMonths, calculateBill, loanForPeriod, meterUsage, type BillingInput, type BillingTariff } from "@/lib/billing/calculate";

const t = (p: Partial<BillingTariff> & Pick<BillingTariff, "chargeType" | "priceEur">): BillingTariff => ({
  connectionKind: null,
  feeClass: null,
  areaId: null,
  name: "",
  unit: p.chargeType === "usage_fee" ? "m3" : "month",
  vatPercent: 25.5,
  validFrom: "2024-09-01",
  validTo: null,
  ...p,
});

// Joutsan hinnasto 1.9.2024 alkaen, alv 0 %.
const JOUTSA: BillingTariff[] = [
  t({ chargeType: "usage_fee", connectionKind: "water", priceEur: 0.95, validTo: "2026-09-30" }),
  t({ chargeType: "usage_fee", connectionKind: "wastewater", priceEur: 2.92 }),
  t({ chargeType: "basic_fee", connectionKind: "water", feeClass: "okt", priceEur: 3.67, validTo: "2026-09-30" }),
  t({ chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", priceEur: 7.02, validTo: "2026-09-30" }),
  t({ chargeType: "basic_fee", connectionKind: "water", feeClass: "dn25", priceEur: 18.83 }),
  // 1.10.2026 alkaen
  t({ chargeType: "usage_fee", connectionKind: "water", priceEur: 0.98, validFrom: "2026-10-01" }),
  t({ chargeType: "basic_fee", connectionKind: "water", feeClass: "okt", priceEur: 3.98, validFrom: "2026-10-01" }),
  t({ chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", priceEur: 7.58, validFrom: "2026-10-01" }),
];

const base = (over: Partial<BillingInput> = {}): BillingInput => ({
  periodStart: "2025-09-30",
  periodEnd: "2026-03-31",
  areaId: null,
  connections: [
    { id: "w", kind: "water", feeClass: "okt", connectedOn: "2010-01-01", disconnectedOn: null },
    { id: "ww", kind: "wastewater", feeClass: "okt", connectedOn: "2010-01-01", disconnectedOn: null },
  ],
  meters: [
    {
      id: "m1", connectionId: "w", installedOn: "2019-05-15", startReading: 5000, removedOn: null, finalReading: null, multiplier: 1,
      readings: [{ readOn: "2025-09-30", reading: 5657 }, { readOn: "2026-03-31", reading: 5710 }],
    },
  ],
  tariffs: JOUTSA,
  ...over,
});

describe("laskutuskuukaudet", () => {
  it("jakso 30.9.–31.3. on kuusi kuukautta", () => {
    expect(billingMonths("2025-09-30", "2026-03-31")).toEqual(["2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"]);
  });
  it("jakso 31.12.–30.6. on tammi–kesä", () => {
    expect(billingMonths("2025-12-31", "2026-06-30")).toHaveLength(6);
  });
});

describe("Joutsan lasku", () => {
  it("laskee samat rivit kuin Fennoan lasku (vesi ja jätevesi 53 m³, okt)", () => {
    const r = calculateBill(base());
    expect(r.issues).toEqual([]);
    expect(r.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.net])).toEqual([
      ["Vesi", 53, 0.95, 50.35],
      ["Jätevesi", 53, 2.92, 154.76],
      ["Veden perusmaksu", 6, 3.67, 22.02],
      ["Jätevesi perusmaksu", 6, 7.02, 42.12],
    ]);
    expect([r.net, r.vat, r.gross]).toEqual([269.25, 68.66, 337.91]);
  });

  it("mittarinvaihto kesken jakson: vanhan ja uuden mittarin kulutus yhteen", () => {
    const r = calculateBill(
      base({
        meters: [
          { id: "old", connectionId: "w", installedOn: "2019-05-15", startReading: 0, removedOn: "2026-03-31", finalReading: 2368, multiplier: 1,
            readings: [{ readOn: "2025-09-30", reading: 2318 }, { readOn: "2026-03-31", reading: 2368 }] },
          { id: "new", connectionId: "w", installedOn: "2026-03-31", startReading: 0, removedOn: null, finalReading: null, multiplier: 1,
            readings: [{ readOn: "2026-04-30", reading: 12.306 }] },
        ],
        periodEnd: "2026-04-30",
      }),
    );
    expect(r.waterM3).toBe(62.306);
  });

  it("lukema kelpaa, vaikka se on ilmoitettu jakson jälkeen", () => {
    const r = calculateBill(base({ meters: [{ ...base().meters[0], readings: [{ readOn: "2025-09-30", reading: 5657 }, { readOn: "2026-04-12", reading: 5712 }] }] }));
    expect(r.waterM3).toBe(55);
  });

  it("puuttuva lukema on huomautus, ei nollalaskua hiljaa", () => {
    const r = calculateBill(base({ meters: [{ ...base().meters[0], readings: [{ readOn: "2025-09-30", reading: 5657 }] }] }));
    expect(r.issues.join()).toMatch(/lukema puuttuu/);
  });

  it("hinnanmuutos 1.10.2026: perusmaksu kuukausittain, käyttömaksu päivien suhteessa", () => {
    const r = calculateBill(
      base({
        periodStart: "2026-08-31",
        periodEnd: "2026-10-31",
        meters: [{ ...base().meters[0], readings: [{ readOn: "2026-08-31", reading: 100 }, { readOn: "2026-10-31", reading: 161 }] }],
      }),
    );
    const water = r.lines.filter((l) => l.description === "Vesi");
    expect(water.map((l) => [l.quantity, l.unitPrice])).toEqual([
      [30, 0.95],
      [31, 0.98],
    ]);
    const fee = r.lines.filter((l) => l.description === "Veden perusmaksu");
    expect(fee.map((l) => [l.quantity, l.unitPrice])).toEqual([
      [1, 3.67],
      [1, 3.98],
    ]);
  });

  it("pelkkä jätevesiliittymä: kulutus sen omasta mittarista, ei vesirivejä", () => {
    const r = calculateBill(
      base({
        connections: [{ id: "ww", kind: "wastewater", feeClass: "okt", connectedOn: "2010-01-01", disconnectedOn: null }],
        meters: [{ ...base().meters[0], connectionId: "ww" }],
      }),
    );
    expect(r.lines.map((l) => l.description)).toEqual(["Jätevesi", "Jätevesi perusmaksu"]);
    expect(r.wastewaterM3).toBe(53);
  });

  it("kerroin kertoo kulutuksen", () => {
    const u = meterUsage(
      { id: "k", connectionId: "w", installedOn: "2020-01-01", startReading: 29710, removedOn: null, finalReading: null, multiplier: 50, readings: [{ readOn: "2026-03-31", reading: 29874 }] },
      "2025-09-30",
      "2026-03-31",
    );
    expect(u?.m3).toBe(8200);
  });

  it("negatiivinen kulutus hyvitetään kuten vanhassa järjestelmässä, huomautuksella", () => {
    const r = calculateBill(base({ meters: [{ ...base().meters[0], readings: [{ readOn: "2025-09-30", reading: 1895 }, { readOn: "2026-03-31", reading: 1893 }] }] }));
    expect(r.waterM3).toBe(-2);
    expect(r.lines.find((l) => l.description === "Vesi")?.net).toBe(-1.9);
    expect(r.issues.join()).toMatch(/pienempi kuin edellinen.*Tarkista/);
  });

  it("suuri negatiivinen kulutus ei tuota hyvitystä", () => {
    const r = calculateBill(base({ meters: [{ ...base().meters[0], readings: [{ readOn: "2025-09-30", reading: 8283 }, { readOn: "2026-03-31", reading: 1265 }] }] }));
    expect(r.waterM3).toBe(0);
    expect(r.lines.every((l) => l.net >= 0)).toBe(true);
    expect(r.issues.join()).toMatch(/mittarinvaihto tai näppäilyvirhe/);
  });

  it("puuttuva perusmaksuluokka on huomautus", () => {
    const r = calculateBill(base({ connections: base().connections.map((c) => ({ ...c, feeClass: null })) }));
    expect(r.issues.join()).toMatch(/perusmaksuluokka puuttuu/);
  });
});

// Kärkinen: verolliset hinnat 1.1.2026 alkaen, perusmaksu kiinteistöä kohden (jätevesiliittymällä).
const KARKINEN: BillingTariff[] = [
  t({ chargeType: "basic_fee", connectionKind: "wastewater", feeClass: "okt", name: "Perusmaksu", priceEur: 51.36, validFrom: "2026-01-01", priceIncludesVat: true }),
  t({ chargeType: "usage_fee", connectionKind: "water", priceEur: 2.57, validFrom: "2026-01-01", priceIncludesVat: true }),
  t({ chargeType: "usage_fee", connectionKind: "wastewater", priceEur: 3.28, validFrom: "2026-01-01", priceIncludesVat: true }),
];

const karkinen = (over: Partial<BillingInput> = {}): BillingInput => ({
  periodStart: "2026-08-31",
  periodEnd: "2026-09-30",
  areaId: null,
  mode: "estimate",
  estimateM3: 2,
  connections: [
    { id: "w", kind: "water", feeClass: "none", connectedOn: "2026-01-01", disconnectedOn: null },
    { id: "ww", kind: "wastewater", feeClass: "okt", connectedOn: "2026-01-01", disconnectedOn: null },
  ],
  meters: [],
  tariffs: KARKINEN,
  ...over,
});

describe("Kärkisen arviolasku", () => {
  it("verollinen hinta: vero lasketaan rivin summasta taaksepäin", () => {
    const r = calculateBill(karkinen());
    expect(r.issues).toEqual([]);
    expect(r.lines.map((l) => [l.description, l.quantity, l.net, l.vat])).toEqual([
      ["Vesi, arvio", 2, 4.1, 1.04],
      ["Jätevesi, arvio", 2, 5.23, 1.33],
      ["Perusmaksu", 1, 40.92, 10.44],
    ]);
    expect(r.gross).toBe(63.06);
  });

  it("kiinteistön maksut ja lainaosuuden loppuerä kuten ennakkolistassa", () => {
    const r = calculateBill(
      karkinen({
        propertyCharges: [
          { name: "Lisäperusmaksu", unit: "month", priceEur: 39, vatPercent: 25.5, priceIncludesVat: true, validFrom: "2026-01-01", validTo: null },
          { name: "Liittymän lisämaksu", unit: "month", priceEur: 72, vatPercent: 0, priceIncludesVat: true, validFrom: "2026-01-01", validTo: null },
          { name: "Jäsenmaksu", unit: "once", priceEur: 100, vatPercent: 0, priceIncludesVat: true, validFrom: "2026-10-01", validTo: null },
        ],
        loans: [{ balance: 245.08, balanceDate: "2026-08-31", monthlyAmortization: 40.03, interestPercent: 5, finalMonth: "2026-09-01" }],
      }),
    );
    expect(r.lines.slice(3).map((l) => [l.description, l.net, l.vat])).toEqual([
      ["Lisäperusmaksu", 31.08, 7.92],
      ["Liittymän lisämaksu", 72, 0],
      ["Pääoman lyhennys", 40.03, 0],
      ["Pääoman lyhennys", 205.05, 0],
      ["Korko 5 %", 1.02, 0],
    ]);
    expect([r.vat, r.gross]).toEqual([20.73, 420.16]);
  });

  it("perusmaksuton liittymä ei tuota huomautusta", () => {
    const r = calculateBill(karkinen({ connections: [{ id: "w", kind: "water", feeClass: "none", connectedOn: "2026-01-01", disconnectedOn: null }] }));
    expect(r.issues).toEqual([]);
    expect(r.lines.map((l) => l.description)).toEqual(["Vesi, arvio"]);
  });

  it("lainan korko lasketaan kuukausittain kuun alun saldosta", () => {
    const loan = { balance: 753.91, balanceDate: "2026-08-31", monthlyAmortization: 38.06, interestPercent: 5, finalMonth: null };
    expect(loanForPeriod(loan, ["2026-09-01"])).toEqual({ amortization: 38.06, payoff: 0, interest: 3.14, balanceAfter: 715.85 });
    expect(loanForPeriod(loan, ["2026-10-01"])).toMatchObject({ amortization: 38.06, interest: 2.98 });
    expect(loanForPeriod({ ...loan, balance: 20 }, ["2026-09-01", "2026-10-01"])).toMatchObject({ amortization: 20, interest: 0.08, balanceAfter: 0 });
  });

  it("lainaosuus ilman kuukausierää on huomautus, ei laskuriviä", () => {
    const r = calculateBill(karkinen({ loans: [{ balance: 4500, balanceDate: "2026-08-31", monthlyAmortization: 0, interestPercent: 5, finalMonth: null }] }));
    expect(r.lines.some((l) => l.description.startsWith("Pääoman"))).toBe(false);
    expect(r.issues.join()).toMatch(/ei ole kuukausierää/);
  });

  it("tasauslaskulle ei tule kiinteistön maksuja eikä lainaa", () => {
    const r = calculateBill(
      karkinen({
        mode: "settlement",
        billedEstimateM3: 2,
        propertyCharges: [{ name: "Lisäperusmaksu", unit: "month", priceEur: 39, vatPercent: 25.5, priceIncludesVat: true, validFrom: "2026-01-01", validTo: null }],
      }),
    );
    expect(r.lines.some((l) => l.description === "Lisäperusmaksu")).toBe(false);
  });
});
