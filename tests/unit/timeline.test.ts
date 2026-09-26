import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineData } from "@/lib/registry/timeline";

const data: TimelineData = {
  contracts: [
    { id: "c1", customer_id: "A", customer_name: "Myyjä", role: "owner", billed: true, starts_on: "2015-01-01", ends_on: "2026-01-15", tenant_components: ["usage"] },
    { id: "c2", customer_id: "B", customer_name: "Ostaja", role: "owner", billed: true, starts_on: "2026-01-16", ends_on: null, tenant_components: ["usage"] },
    { id: "c3", customer_id: "T", customer_name: "Vuokralainen", role: "tenant", billed: true, starts_on: "2020-06-01", ends_on: "2021-05-31", tenant_components: ["usage", "basic_fee"] },
  ],
  connections: [{ id: "k", kind: "water", connected_on: "2010-01-01", disconnected_on: null }],
  meters: [
    { id: "m1", connection_kind: "water", meter_number: "123", read_method: "mechanical", installed_on: "2015-01-01", start_reading: "0", removed_on: "2026-06-15", final_reading: "530" },
    { id: "m2", connection_kind: "water", meter_number: "WM1", read_method: "remote", installed_on: "2026-06-15", start_reading: "0.5", removed_on: null, final_reading: null },
  ],
  readings: [{ id: "r", meter_number: "123", read_on: "2026-01-15", reading: "520", status: "accepted", source: "staff" }],
  invoices: [{ id: "i", run_id: "run", kind: "actual", customer_name: "Myyjä", period_start: "2025-09-30", period_end: "2026-01-15", gross_eur: "61.5", status: "draft" }],
  events: [
    { id: "e1", kind: "ownership_change", event_date: "2026-01-15", notes: null, details: { fromCustomerId: "A", toCustomerId: "B", fromContractId: "c1", toContractId: "c2", loanDecision: "stays_with_seller" } },
    { id: "e2", kind: "meter_change", event_date: "2026-06-15", notes: null, details: { oldMeterId: "m1", newMeterId: "m2", oldMeterNumber: "123", newMeterNumber: "WM1", finalReading: 530, startReading: 0.5, source: "campaign" } },
  ],
  people: [],
};

describe("aikajana", () => {
  const { entries, lanes } = buildTimeline(data);

  it("tapahtuma kokoaa omat sopimus- ja mittarimuutoksensa", () => {
    expect(entries.filter((e) => e.category === "contract").map((e) => e.title)).toEqual([
      "Käyttösopimus päättyi: Vuokralainen",
      "Käyttösopimus alkoi: Vuokralainen",
    ]);
    expect(entries.filter((e) => e.category === "meter").map((e) => e.title)).toEqual(["Liittymä (vesi) liitettiin"]);
    const own = entries.find((e) => e.title === "Omistajanvaihdos")!;
    expect(own.detail).toBe("Myyjä → Ostaja · laina jäi myyjälle");
    expect(entries.find((e) => e.title === "Mittarinvaihto")!.detail).toBe("123 (loppu 530) → WM1 (alku 0,5) · vaihtokampanja");
  });

  it("uusin ensin, saman päivän tapahtuma ennen lukemaa ja laskua", () => {
    const sameDay = entries.filter((e) => e.date === "2026-01-15").map((e) => e.category);
    expect(sameDay).toEqual(["event", "reading", "invoice"]);
    expect(entries[0].date).toBe("2026-06-15");
  });

  it("kaistat osapuolista ja mittareista", () => {
    expect(lanes.map((l) => [l.label, l.segments.map((s) => s.label)])).toEqual([
      ["Omistaja", ["Myyjä", "Ostaja"]],
      ["Vuokralainen", ["Vuokralainen"]],
      ["Mittari (vesi)", ["123", "WM1"]],
    ]);
  });

  it("lasku ja sen jakso", () => {
    const inv = entries.find((e) => e.category === "invoice")!;
    expect([inv.title, inv.detail, inv.href]).toEqual(["Lasku 1.10.2025 – 15.1.2026", "Myyjä, 61,5 €", "/laskutus/run/i"]);
  });
});
