import { describe, expect, it } from "vitest";
import { invoiceInfo } from "@/lib/billing/info";

describe("laskun lisätieto", () => {
  it("sama muoto kuin Joutsan nykyisillä laskuilla", () => {
    const info = invoiceInfo({
      usage: [{ meterId: "m", connectionKind: "water", from: { readOn: "2025-09-30", reading: 5657 }, to: { readOn: "2026-03-31", reading: 5710 }, m3: 53 }],
      meters: [{ id: "m", multiplier: 1 }],
      legacyId: "71030",
      address: "Leivonmäentie 23",
    });
    expect(info).toBe("Edellinen lukema 5657 m3, 30.9.2025 - 31.3.2026: 5710 m3, Unes: 71030 / Leivonmäentie 23");
  });

  it("mittarinvaihto: kaksi riviä, desimaalit pilkulla, mittarinumero kun tiedossa", () => {
    const info = invoiceInfo({
      usage: [
        { meterId: "old", connectionKind: "water", from: { readOn: "2025-09-30", reading: 2318 }, to: { readOn: "2026-03-31", reading: 2368 }, m3: 50 },
        { meterId: "new", connectionKind: "water", from: { readOn: "2026-03-31", reading: 0 }, to: { readOn: "2026-04-30", reading: 12.306 }, m3: 12.306 },
      ],
      meters: [{ id: "old", multiplier: 1 }, { id: "new", meterNumber: "KM2104A77", multiplier: 1 }],
      legacyId: "30660",
      address: "Kuusitie 4",
    });
    expect(info.split("\n")).toEqual([
      "Edellinen lukema 2318 m3, 30.9.2025 - 31.3.2026: 2368 m3, Unes: 30660 / Kuusitie 4",
      "Mittari KM2104A77: edellinen lukema 0 m3, 31.3.2026 - 30.4.2026: 12,306 m3, Unes: 30660 / Kuusitie 4",
    ]);
  });

  it("teollisuusmittarin kerroin ja kulutus", () => {
    const info = invoiceInfo({
      usage: [{ meterId: "k", connectionKind: "water", from: { readOn: "2025-09-30", reading: 29710 }, to: { readOn: "2026-03-31", reading: 29874 }, m3: 8200 }],
      meters: [{ id: "k", multiplier: 50 }],
      legacyId: null,
      address: "Tehdaskatu 1",
    });
    expect(info).toBe("Edellinen lukema 29710 m3, 30.9.2025 - 31.3.2026: 29874 m3, kerroin 50, kulutus 8200 m3, Tehdaskatu 1");
  });

  it("puuttuva lukema ei tuota riviä", () => {
    expect(
      invoiceInfo({ usage: [{ meterId: "m", connectionKind: "water", from: null, to: null, m3: 0 }], meters: [], legacyId: "1", address: "X" }),
    ).toBe("");
  });
});
