import { describe, expect, it } from "vitest";
import type { BillingLine } from "@/lib/billing/calculate";
import { changeBoundaries, partiesOn, splitByParty, type PartyContract } from "@/lib/billing/parties";

const contract = (id: string, customer: string, role: "owner" | "tenant", starts: string, ends: string | null = null, comps = ["usage"]): PartyContract => ({
  id, customer_id: customer, role, starts_on: starts, ends_on: ends, tenant_components: comps,
});
const line = (kind: BillingLine["kind"], description: string, loanIndex?: number): BillingLine => ({
  kind, connectionKind: null, description, quantity: 1, unit: "month", unitPrice: 1, vatPercent: 0, net: 1, vat: 0, priceIncludesVat: false, loanIndex,
});
const loan = (debtor: string | null = null) => ({ balance: 100, balanceDate: "2026-01-01", monthlyAmortization: 10, interestPercent: 0, finalMonth: null, debtorCustomerId: debtor });

describe("osapuolten vaihdos jaksolla", () => {
  it("sopimus alkaa jakson ensimmäisenä päivänä: ei rajaa", () => {
    expect(changeBoundaries([contract("a", "A", "owner", "2026-02-01")], "2026-01-31", "2026-02-28")).toEqual([]);
  });
  it("omistajanvaihdos 15.5.: raja 14.5.", () => {
    const cs = [contract("a", "A", "owner", "2020-01-01", "2026-05-14"), contract("b", "B", "owner", "2026-05-15")];
    expect(changeBoundaries(cs, "2026-03-31", "2026-09-30")).toEqual(["2026-05-14"]);
  });
  it("vuokralainen muuttaa pois kesken jakson: raja muuttopäivään", () => {
    const cs = [contract("a", "A", "owner", "2020-01-01"), contract("t", "T", "tenant", "2025-01-01", "2026-06-30")];
    expect(changeBoundaries(cs, "2026-03-31", "2026-09-30")).toEqual(["2026-06-30"]);
    expect(partiesOn(cs, "2026-09-30")).toEqual({ owner: cs[0], tenant: null });
  });
});

describe("rivien jako osapuolille", () => {
  const owner = contract("o", "O", "owner", "2020-01-01");
  const tenant = contract("t", "T", "tenant", "2020-01-01");
  const lines = [line("usage", "Vesi"), line("basic_fee", "Perusmaksu"), line("other_fee", "Pääoman lyhennys", 0)];

  it("vuokralainen kulutus, omistaja muut ja laina", () => {
    const { invoices, issues } = splitByParty(lines, { owner, tenant }, [loan()], [owner, tenant]);
    expect(issues).toEqual([]);
    expect(invoices.map((i) => [i.customerId, i.lines.map((l) => l.description), i.primary])).toEqual([
      ["O", ["Perusmaksu", "Pääoman lyhennys"], false],
      ["T", ["Vesi"], true],
    ]);
  });

  it("käyttösopimus kaikista osista: laina silti omistajalle", () => {
    const all = contract("t", "T", "tenant", "2020-01-01", null, ["usage", "basic_fee", "other_fee"]);
    const { invoices } = splitByParty(lines, { owner, tenant: all }, [loan()], [owner, all]);
    expect(invoices.map((i) => [i.customerId, i.lines.length])).toEqual([["O", 1], ["T", 2]]);
  });

  it("laina jäänyt myyjälle: oma lasku myyjälle", () => {
    const seller = contract("s", "S", "owner", "2010-01-01", "2025-12-31");
    const { invoices } = splitByParty(lines, { owner, tenant: null }, [loan("S")], [seller, owner]);
    const debtor = invoices.find((i) => i.customerId === "S")!;
    expect(debtor.role).toBe("debtor");
    expect(debtor.contractId).toBe("s");
    expect(debtor.lines.map((l) => l.description)).toEqual(["Pääoman lyhennys"]);
  });

  it("liittymissopimus puuttuu: omistajan osuus vuokralaiselle ja huomautus", () => {
    const { invoices, issues } = splitByParty(lines, { owner: null, tenant }, [loan()], [tenant]);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].customerId).toBe("T");
    expect(issues.join()).toMatch(/Liittymissopimus puuttuu/);
  });

  it("ei sopimuksia: yksi lasku ilman maksajaa", () => {
    const { invoices } = splitByParty(lines, { owner: null, tenant: null }, [loan()], []);
    expect(invoices.map((i) => [i.customerId, i.lines.length])).toEqual([[null, 3]]);
  });
});
