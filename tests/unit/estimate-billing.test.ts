import { describe, expect, it } from "vitest";
import { calculateBill, estimateAnnualM3, type BillingInput, type BillingMeter, type BillingTariff } from "@/lib/billing/calculate";

const t = (p: Partial<BillingTariff> & Pick<BillingTariff, "chargeType" | "priceEur">): BillingTariff => ({
  connectionKind: null, feeClass: null, areaId: null, name: "", unit: p.chargeType === "usage_fee" ? "m3" : "month",
  vatPercent: 25.5, validFrom: "2024-01-01", validTo: null, ...p,
});

// Kuvitteellinen osuuskunta: vesi ja jätevesi, lisäperusmaksu ja lainaosuus.
const TARIFFS: BillingTariff[] = [
  t({ chargeType: "usage_fee", connectionKind: "water", priceEur: 1.5, name: "Vesi" }),
  t({ chargeType: "basic_fee", connectionKind: "water", feeClass: "okt", priceEur: 5, name: "Perusmaksu" }),
  t({ chargeType: "extra_basic_fee", priceEur: 4, name: "Lisäperusmaksu" }),
  t({ chargeType: "loan_share", priceEur: 120, unit: "year", vatPercent: 0, name: "Lainaosuus" }),
];
const meter: BillingMeter = {
  id: "m", connectionId: "w", installedOn: "2020-01-01", startReading: 0, removedOn: null, finalReading: null, multiplier: 1,
  readings: [{ readOn: "2025-09-30", reading: 100 }, { readOn: "2026-09-30", reading: 220 }],
};
const base: BillingInput = {
  periodStart: "2026-09-30", periodEnd: "2026-10-31", areaId: null,
  connections: [{ id: "w", kind: "water", feeClass: "okt", connectedOn: "2010-01-01", disconnectedOn: null }],
  meters: [meter], tariffs: TARIFFS,
};

describe("vuosikulutusarvio", () => {
  it("vuoden lukemista", () => {
    expect(estimateAnnualM3([meter], "2026-09-30")).toBe(120);
  });
  it("alle puolen vuoden lukemista ei arviota", () => {
    expect(estimateAnnualM3([{ ...meter, installedOn: "2026-06-01", readings: [{ readOn: "2026-09-30", reading: 40 }] }], "2026-09-30")).toBeNull();
  });
});

describe("arviolasku", () => {
  it("kuukauden arvio, perusmaksu, lisäperusmaksu ja lainaosuus", () => {
    const r = calculateBill({ ...base, mode: "estimate", estimateM3: 10 });
    expect(r.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.net])).toEqual([
      ["Vesi, arvio", 10, 1.5, 15],
      ["Veden perusmaksu", 1, 5, 5],
      ["Lisäperusmaksu", 1, 4, 4],
      ["Lainaosuus", 0.0833, 120, 10],
    ]);
    expect(r.usage).toEqual([]);
  });
});

describe("tasaus", () => {
  it("toteutunut miinus laskutettu, ei perusmaksuja", () => {
    const r = calculateBill({ ...base, periodStart: "2025-09-30", periodEnd: "2026-09-30", mode: "settlement", billedEstimateM3: 100 });
    expect(r.lines.map((l) => [l.description, l.quantity, l.net])).toEqual([["Vesi, tasaus", 20, 30]]);
  });
  it("liikaa laskutettu hyvitetään", () => {
    const r = calculateBill({ ...base, periodStart: "2025-09-30", periodEnd: "2026-09-30", mode: "settlement", billedEstimateM3: 130 });
    expect(r.lines.map((l) => [l.description, l.quantity, l.net])).toEqual([["Vesi, tasaus", -10, -15]]);
    expect(r.net).toBe(-15);
  });
});

describe("toteutunut kulutus ja muut maksut", () => {
  it("lisäperusmaksu ja lainaosuus kuukausittain myös toteutuneen kulutuksen laskulla", () => {
    const r = calculateBill({ ...base, periodStart: "2025-09-30", periodEnd: "2026-09-30" });
    const other = r.lines.filter((l) => l.kind === "other_fee").map((l) => [l.description, l.quantity, l.net]);
    expect(other).toEqual([
      ["Lisäperusmaksu", 12, 48],
      ["Lainaosuus", 1, 120],
    ]);
  });
});
