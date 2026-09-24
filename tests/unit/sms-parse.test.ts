import { describe, expect, it } from "vitest";
import { parseSms } from "@/lib/sms/parse";

describe("tekstiviestin tulkinta", () => {
  it.each([
    ["1234", 1234],
    ["1234,5", 1234.5],
    ["Lukema 1234 m3", 1234],
    ["lukema: 1 234", 1234],
    ["Hei, mittarin lukema on 5710 kuutiota. Terveisin Matti", 5710],
    ["Kivitie 8 1264", 1264],
    ["1264 25.9.", 1264],
    ["25.9.2026 lukema 1264", 1264],
  ])("%s → %s", (body, reading) => {
    expect(parseSms(body)).toMatchObject({ reading, problem: null });
  });

  it("käyttöpaikan tunnus ja lukema", () => {
    expect(parseSms("40960 1264")).toEqual({ reading: 1264, placeId: "40960", problem: null });
  });

  it("ei lukemaa tai useita lukuja", () => {
    expect(parseSms("Soittakaa minulle").problem).toMatch(/ei ole lukemaa/);
    expect(parseSms("1234 ja 5678").problem).toMatch(/useita/);
  });
});
