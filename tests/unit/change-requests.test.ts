import { describe, expect, it } from "vitest";
import { parseChangeRequest, splitAddress } from "@/lib/change-requests";

const TODAY = "2026-09-26";
const form = (fields: Record<string, string>) => (name: string) => fields[name] ?? null;
const base = { placeText: "Kuusitie 4, Joutsa", submitterName: "Maija Myyjä", submitterEmail: "maija@example.fi" };

describe("muutosilmoituksen tarkistus", () => {
  it("kauppa: ostaja ja luovutuspäivä pakollisia, lukema luvuksi", () => {
    expect(parseChangeRequest("sale", form({ ...base, changeDate: "2026-10-01" }), TODAY)).toBe("Kerro ostajan nimi.");
    const ok = parseChangeRequest("sale", form({ ...base, changeDate: "2026-10-01", partyName: "Olli Ostaja", reading: "1234,5", loanAnswer: "transfers" }), TODAY);
    expect(ok).toMatchObject({ kind: "sale", partyName: "Olli Ostaja", reading: 1234.5, loanAnswer: "transfers", changeDate: "2026-10-01" });
  });

  it("henkilötunnus torjutaan", () => {
    const r = parseChangeRequest("other", form({ ...base, message: "Tunnukseni on 010190-123A" }), TODAY);
    expect(r).toMatch(/henkilötunnusta/);
  });

  it("yhteystieto vaaditaan ja puhelin normalisoidaan", () => {
    expect(parseChangeRequest("other", form({ placeText: "X", submitterName: "Y", message: "Z" }), TODAY)).toMatch(/sähköpostiosoite tai puhelinnumero/);
    const r = parseChangeRequest("other", form({ placeText: "X", submitterName: "Y", submitterPhone: "040 123 4567", message: "Z" }), TODAY);
    expect(r).toMatchObject({ submitterPhone: "+358401234567" });
  });

  it("päivä ei voi olla kaukana tulevaisuudessa", () => {
    expect(parseChangeRequest("move_out", form({ ...base, changeDate: "2027-12-01" }), TODAY)).toBe("Tarkista päivämäärä.");
  });

  it("laskutustietojen muutos vaatii uuden tiedon, päivää ei tallenneta", () => {
    expect(parseChangeRequest("billing", form(base), TODAY)).toMatch(/uusi laskutusosoite/);
    expect(parseChangeRequest("billing", form({ ...base, changeDate: "2026-09-01", partyAddress: "Uusitie 1, 19650 Joutsa" }), TODAY)).toMatchObject({ changeDate: null });
  });
});

describe("osoitteen jako", () => {
  it("katu, postinumero ja paikkakunta", () => {
    expect(splitAddress("Uusitie 1, 19650 Joutsa")).toEqual({ street: "Uusitie 1", postalCode: "19650", city: "Joutsa" });
    expect(splitAddress("Uusitie 1 19650 Joutsa")).toEqual({ street: "Uusitie 1", postalCode: "19650", city: "Joutsa" });
    expect(splitAddress("Uusitie 1")).toEqual({ street: "Uusitie 1", postalCode: null, city: null });
  });
});
