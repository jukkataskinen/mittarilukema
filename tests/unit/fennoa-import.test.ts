import { describe, expect, it } from "vitest";
import { buildMeterChains, joutsaAreaName, matchCustomer, similarity, titleCaseAddress, type RawReading } from "@/lib/import/fennoa";

const r = (p: Partial<RawReading> & Pick<RawReading, "invoice" | "end" | "previous" | "current">): RawReading => ({
  position: 0,
  start: null,
  multiplier: 1,
  status: "accepted",
  note: null,
  ...p,
});

describe("osoitteet ja nimet", () => {
  it("isot kirjaimet osoitemuotoon", () => {
    expect(titleCaseAddress("LEIVONMÄENTIE 23 B")).toBe("Leivonmäentie 23 B");
    expect(titleCaseAddress("  KOIVU-AHO  4 ")).toBe("Koivu-Aho 4");
  });
  it("samankaltaisuus", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("matti virtanen", "matti virtanen liisa ja")).toBeGreaterThan(0.6);
  });
});

describe("alue käyttöpaikan tunnuksesta", () => {
  it("ensimmäinen numero, 9 on Rutalahti", () => {
    expect(joutsaAreaName("40960")).toBe("Alue 4");
    expect(joutsaAreaName("71030")).toBe("Alue 7");
    expect(joutsaAreaName("90100")).toBe("Rutalahti");
    expect(joutsaAreaName("0123")).toBeNull();
    expect(joutsaAreaName(null)).toBeNull();
  });
});

describe("asiakkaan yhdistäminen", () => {
  const list = [
    { id: "1", name: "Virtanen Matti", street: "Kuusitie 4", postalCode: "19650" },
    { id: "2", name: "Esimerkki Oy", street: "Tehdaskatu 1", postalCode: "19650" },
    { id: "3", name: "Virtanen Matti", street: "Rantatie 9", postalCode: "41770" },
  ];
  it("sama nimi ja osoite", () => {
    expect(matchCustomer({ name: "Virtanen Matti", street: "KUUSITIE 4", postalCode: "19650" }, list)?.id).toBe("1");
  });
  it("nimen lisäosa samassa osoitteessa", () => {
    expect(matchCustomer({ name: "Virtanen Matti ja Liisa", street: "Kuusitie 4", postalCode: "19650" }, list)?.id).toBe("1");
  });
  it("sanajärjestys ei haittaa", () => {
    expect(matchCustomer({ name: "Matti Virtanen", street: "Rantatie 9", postalCode: "41770" }, list)?.id).toBe("3");
  });
  it("ei vastinetta", () => {
    expect(matchCustomer({ name: "Toinen Henkilö", street: "Muutie 1", postalCode: "19650" }, list)).toBeNull();
  });
});

describe("mittariketjut", () => {
  it("peräkkäiset laskut samalla mittarilla", () => {
    const chains = buildMeterChains([
      r({ invoice: "10", start: "2025-09-30", end: "2026-03-31", previous: 100, current: 150 }),
      r({ invoice: "20", start: "2026-03-31", end: "2026-08-31", previous: 150, current: 190 }),
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ installedOn: "2025-09-30", startReading: 100, removedOn: null });
    expect(chains[0].readings.map((x) => x.reading)).toEqual([150, 190]);
  });

  it("mittarinvaihto samalla laskulla", () => {
    const chains = buildMeterChains([
      r({ invoice: "10", position: 0, end: "2026-04-30", previous: 2318, current: 2368 }),
      r({ invoice: "10", position: 1, end: "2026-04-30", previous: 0, current: 12.306 }),
    ]);
    expect(chains).toHaveLength(2);
    expect(chains[0]).toMatchObject({ removedOn: "2026-04-30", finalReading: 2368 });
    expect(chains[1]).toMatchObject({ installedOn: "2026-04-30", startReading: 0 });
    expect(chains[1].readings[0].reading).toBe(12.306);
  });

  it("mittarinvaihto, kun uusi mittari on laskulla ensin", () => {
    const chains = buildMeterChains([
      r({ invoice: "10", position: 0, end: "2026-04-30", previous: 0, current: 8.5 }),
      r({ invoice: "10", position: 1, end: "2026-04-30", previous: 900, current: 940 }),
    ]);
    expect(chains.map((c) => [c.startReading, c.finalReading])).toEqual([
      [900, 940],
      [0, null],
    ]);
  });

  it("korjauslaskun lukema korvaa aiemman", () => {
    const chains = buildMeterChains([
      r({ invoice: "10", end: "2026-03-31", previous: 100, current: 1150 }),
      r({ invoice: "30", end: "2026-03-31", previous: 100, current: 150 }),
    ]);
    expect(chains[0].readings.map((x) => [x.reading, x.status])).toEqual([
      [1150, "rejected"],
      [150, "accepted"],
    ]);
  });
});
