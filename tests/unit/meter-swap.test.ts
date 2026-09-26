import { describe, expect, it } from "vitest";
import { CampaignError, checkSwapRows, parseDate, parseSwapCsv, type OrgMeter } from "@/lib/meters/campaign";
import { swapProblem } from "@/lib/meters/swap";

const meter = (id: string, no: string, place: string, over: Partial<OrgMeter> = {}): OrgMeter => ({
  id, meterNumber: no, placeCode: place, propertyId: `p-${place}`, installedOn: "2015-01-01", startReading: 0, removedOn: null,
  readings: [{ readOn: "2026-03-31", reading: 500, status: "accepted" }], ...over,
});
const TODAY = "2026-09-26";

describe("vaihdon tarkistukset", () => {
  const m = meter("a", "123", "10");
  const ok = { date: "2026-09-15", finalReading: 520, newMeterNumber: "WM1", startReading: 0 };
  it("kelvollinen vaihto", () => expect(swapProblem(m, ok, TODAY)).toBeNull());
  it("loppulukema pienempi kuin edellinen", () => expect(swapProblem(m, { ...ok, finalReading: 499 }, TODAY)).toMatch(/pienempi/));
  it("tulevaisuuden päivä", () => expect(swapProblem(m, { ...ok, date: "2026-10-01" }, TODAY)).toMatch(/tulevaisuudessa/));
  it("lukema vaihdon jälkeen", () => {
    const later = { ...m, readings: [...m.readings, { readOn: "2026-09-20", reading: 3, status: "needs_review" }] };
    expect(swapProblem(later, ok, TODAY)).toMatch(/vaihtopäivän jälkeen/);
  });
  it("sama numero", () => expect(swapProblem(m, { ...ok, newMeterNumber: " 123 " }, TODAY)).toMatch(/sama/));
});

describe("CSV", () => {
  it("tunnistaa otsikot ja erottimen", () => {
    const { rows } = parseSwapCsv("﻿Vanha mittari;Vaihtopäivä;Loppulukema;Uusi mittari\n123;15.9.2026;520,5;WM1\n\n");
    expect(rows).toEqual([{ rowNo: 2, raw: { old: "123", date: "15.9.2026", final: "520,5", new: "WM1" } }]);
  });
  it("puuttuva sarake kerrotaan", () => {
    expect(() => parseSwapCsv("Vanha mittari,Uusi mittari\n1,2")).toThrow(CampaignError);
  });
  it("päivämäärät", () => {
    expect(parseDate("1.4.2026")).toBe("2026-04-01");
    expect(parseDate("2026-04-01")).toBe("2026-04-01");
    expect(parseDate("31.2.2026")).toBeNull();
  });
});

describe("erän rivit", () => {
  const meters = [
    meter("a", "123", "10"),
    meter("b", "124", "11"),
    meter("c", "200", "12"),
    meter("d", "200", "13"),
    meter("e", "300", "14", { removedOn: "2026-06-01" }),
    meter("f", "WM9", "14", { installedOn: "2026-06-01", readings: [] }),
  ];
  const row = (rowNo: number, raw: Record<string, string>) => ({ rowNo, raw });
  const checked = checkSwapRows(
    [
      row(2, { old: "123", date: "15.9.2026", final: "520", new: "WM1" }),
      row(3, { old: "200", date: "15.9.2026", final: "520", new: "WM2" }),
      row(4, { old: "200", place: "13", date: "15.9.2026", final: "520", new: "WM3" }),
      row(5, { old: "300", date: "1.6.2026", final: "520", new: "WM9" }),
      row(6, { old: "999", date: "15.9.2026", final: "520", new: "WM4" }),
      row(7, { old: "124", date: "15.9.2026", final: "520", new: "WM1" }),
      row(8, { old: "124", date: "xx", final: "520", new: "WM5" }),
    ],
    meters,
    TODAY,
  );
  const st = (n: number) => checked.find((r) => r.rowNo === n)!;
  it("valmis rivi", () => expect([st(2).status, st(2).oldMeterId, st(2).readMethod]).toEqual(["ready", "a", "remote"]));
  it("sama numero kahdessa paikassa vaatii käyttöpaikan", () => {
    expect(st(3).status).toBe("error");
    expect(st(4)).toMatchObject({ status: "ready", oldMeterId: "d" });
  });
  it("jo kirjattu vaihto ohitetaan", () => expect(st(5).status).toBe("skipped"));
  it("tuntematon mittari", () => expect(st(6).message).toMatch(/ei löytynyt/));
  it("sama uusi mittari kahdesti", () => expect(st(7).message).toMatch(/aiemmalla rivillä/));
  it("virheellinen päivä", () => expect(st(8).message).toMatch(/Vaihtopäivä/));
});
