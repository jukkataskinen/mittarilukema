import { describe, expect, it } from "vitest";
import { meterReadMethod, parseReading, readingIssues } from "@/lib/readings/checks";
import { formatPhone, normalizePhone } from "@/lib/validation/phone";

describe("lukeman tulkinta", () => {
  it("hyväksyy pilkun, välilyönnit ja kolme desimaalia", () => {
    expect(parseReading("1 234,5")).toBe(1234.5);
    expect(parseReading("12.345")).toBe(12.345);
    expect(parseReading("12,3456")).toBeNull();
    expect(parseReading("-5")).toBeNull();
    expect(parseReading("abc")).toBeNull();
  });
});

describe("lukeman tarkistukset", () => {
  const prev = { reading: 1000, readOn: "2026-02-28" };
  const before = { reading: 950, readOn: "2025-08-31" };

  it("ei huomautettavaa ilman edellistä lukemaa", () => {
    expect(readingIssues(5, "2026-08-31", null)).toEqual([]);
  });
  it("pienempi kuin edellinen", () => {
    expect(readingIssues(999, "2026-08-31", prev)).toEqual(["lower"]);
  });
  it("tavallinen puolen vuoden kulutus menee läpi", () => {
    expect(readingIssues(1055, "2026-08-31", prev, before)).toEqual([]);
  });
  it("nollakulutus menee läpi (vapaa-ajan asunto)", () => {
    expect(readingIssues(1000, "2026-08-31", prev, before)).toEqual([]);
  });
  it("moninkertainen kulutus on piikki", () => {
    expect(readingIssues(1200, "2026-08-31", prev, before)).toEqual(["spike"]);
  });
  it("pieni määrä ei ole piikki, vaikka kerroin ylittyy", () => {
    expect(readingIssues(1010, "2026-03-02", prev, before)).toEqual([]);
  });
  it("yli 300 m³ on aina tarkistettava", () => {
    expect(readingIssues(1301, "2026-08-31", prev)).toEqual(["large"]);
  });
});

describe("puhelinnumero", () => {
  it("kotimainen muoto kansainväliseksi", () => {
    expect(normalizePhone("040 123 4567")).toBe("+358401234567");
    expect(normalizePhone("+358 40 123 4567")).toBe("+358401234567");
    expect(normalizePhone("00358401234567")).toBe("+358401234567");
    expect(normalizePhone("123")).toBeNull();
  });
  it("näyttömuoto", () => {
    expect(formatPhone("+358401234567")).toBe("040 123 4567");
  });
});

describe("mittarityyppi mittarinumerosta", () => {
  it("kolme merkkiä on vanha, pidempi uusi etäluettava", () => {
    expect(meterReadMethod("482")).toBe("mechanical");
    expect(meterReadMethod("21345678")).toBe("remote");
    expect(meterReadMethod("KM2104A77")).toBe("remote");
    expect(meterReadMethod("")).toBeNull();
  });
});
