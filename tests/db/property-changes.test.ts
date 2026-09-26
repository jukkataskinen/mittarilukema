import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createBillingRun, deleteDraftRun } from "@/lib/billing/run";
import { ChangeError, changeOwner, changeTenant, confirmLoanTransfer } from "@/lib/registry/changes";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Ohjattu omistajanvaihdos ja vuokralaisen vaihdos (DECISIONS 26.9.2026). */

let db: Database;
let a: OrgFixture;
let buyer = "";
let renter = "";
let loanId = "";

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  [buyer, renter, loanId] = await db.asService(async (tx) => {
    await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 2, '2024-09-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Veden perusmaksu', 'month', 10, '2024-09-01')`,
      [a.id],
    );
    await tx.query(
      "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 1000, 'import'), ($1, $2, '2026-03-31', 1060, 'import')",
      [a.id, a.meter],
    );
    const [l] = await tx.query<{ id: string }>(
      "insert into ml_property_loans (organization_id, property_id, balance_eur, balance_date, monthly_amortization_eur, interest_percent) values ($1, $2, 1000, '2025-09-30', 50, 0) returning id",
      [a.id, a.property],
    );
    const [b] = await tx.query<{ id: string }>("insert into ml_customers (organization_id, name) values ($1, 'Ostaja') returning id", [a.id]);
    const [r] = await tx.query<{ id: string }>("insert into ml_customers (organization_id, name) values ($1, 'Vuokralainen') returning id", [a.id]);
    return [b.id, r.id, l.id];
  });
});
afterAll(async () => {
  await db.close();
});

const asStaff = <T,>(fn: Parameters<typeof db.asUser<T>>[1]) => db.asUser(a.staff.sub, fn);
const base = () => ({ organizationId: a.id, userId: a.staff.id, propertyId: a.property });

describe("omistajanvaihdos", () => {
  it("vaatii lukeman ja lainan kohtalon, eikä jätä puolikasta tilaa", async () => {
    await expect(
      asStaff((tx) => changeOwner(tx, { ...base(), date: "2026-01-15", newCustomerId: buyer, readings: [], loanDecision: "stays_with_seller", endTenant: false })),
    ).rejects.toThrow(ChangeError);
    await expect(
      asStaff((tx) =>
        changeOwner(tx, { ...base(), date: "2026-01-15", newCustomerId: buyer, readings: [{ meterId: a.meter, reading: 1030 }], loanDecision: null, endTenant: false }),
      ),
    ).rejects.toThrow(/lainaa/);
    const contracts = await asStaff((tx) => tx.query("select 1 from ml_contracts where property_id = $1", [a.property]));
    expect(contracts).toHaveLength(1);
  });

  it("päättää myyjän sopimuksen, aloittaa ostajan ja jättää lainan myyjälle", async () => {
    const r = await asStaff((tx) =>
      changeOwner(tx, {
        ...base(), date: "2026-01-15", newCustomerId: buyer, readings: [{ meterId: a.meter, reading: 1030 }], loanDecision: "stays_with_seller", endTenant: false,
      }),
    );
    expect(r.needsReview).toBe(0);
    const cs = await asStaff((tx) =>
      tx.query<{ customer_id: string; starts_on: string; ends_on: string | null }>(
        "select customer_id, starts_on::text, ends_on::text from ml_contracts where property_id = $1 order by starts_on",
        [a.property],
      ),
    );
    expect(cs.map((c) => [c.customer_id, c.ends_on])).toEqual([
      [a.customer, "2026-01-15"],
      [buyer, null],
    ]);
    expect(cs[1].starts_on).toBe("2026-01-16");
    const [loan] = await asStaff((tx) => tx.query<{ debtor_customer_id: string }>("select debtor_customer_id from ml_property_loans where id = $1", [loanId]));
    expect(loan.debtor_customer_id).toBe(a.customer);
    const [ev] = await asStaff((tx) => tx.query<{ kind: string; details: { readingIds: string[] } }>("select kind, details from ml_property_events", []));
    expect(ev.kind).toBe("ownership_change");
    expect(ev.details.readingIds).toHaveLength(1);
  });

  it("seuraava laskutusajo: myyjälle loppulasku ja lainaosuus, ostajalle oma lasku", async () => {
    const run = await asStaff((tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
    );
    const inv = await asStaff((tx) =>
      tx.query<{ customer_id: string; period_end: string; water_m3: string; issues: string[] }>(
        "select customer_id, period_end::text, water_m3::text, issues from ml_invoices where run_id = $1 order by period_end, water_m3 desc",
        [run.runId],
      ),
    );
    // Myyjä: kulutus 30 m3 ja lainaerät loka–tammi; ostaja: 30 m3, lainaerät helmi–maalis myyjälle omana laskuna.
    expect(inv.map((i) => [i.customer_id, i.period_end, i.water_m3])).toEqual([
      [a.customer, "2026-01-15", "30.000"],
      [buyer, "2026-03-31", "30.000"],
      [a.customer, "2026-03-31", "0.000"],
    ]);
    expect(inv.every((i) => i.issues.length === 0)).toBe(true);
    await asStaff((tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.staff.id, runId: run.runId }));
  });

  it("kauppakirja osoittaa siirron: laina omistajalle", async () => {
    expect(await asStaff((tx) => confirmLoanTransfer(tx, { organizationId: a.id, userId: a.staff.id, loanId }))).toBe(true);
    expect(await asStaff((tx) => confirmLoanTransfer(tx, { organizationId: a.id, userId: a.staff.id, loanId }))).toBe(false);
  });
});

describe("vuokralaisen vaihdos", () => {
  it("uusi vuokralainen maksaa kulutuksen vaihtopäivän jälkeen", async () => {
    await asStaff((tx) =>
      changeTenant(tx, {
        ...base(), date: "2026-02-28", endCurrent: false, newCustomerId: renter, components: ["usage"], readings: [{ meterId: a.meter, reading: 1045 }],
      }),
    );
    const [c] = await asStaff((tx) =>
      tx.query<{ starts_on: string; tenant_components: string[] }>("select starts_on::text, tenant_components from ml_contracts where role = 'tenant'", []),
    );
    expect(c).toEqual({ starts_on: "2026-03-01", tenant_components: ["usage"] });
  });

  it("toista vuokralaista ei voi lisätä päättämättä nykyistä", async () => {
    await expect(
      asStaff((tx) =>
        changeTenant(tx, { ...base(), date: "2026-03-15", endCurrent: false, newCustomerId: a.customer, components: ["usage"], readings: [{ meterId: a.meter, reading: 1050 }] }),
      ),
    ).rejects.toThrow(/jo vuokralainen/);
  });

  it("poismuutto päättää käyttösopimuksen", async () => {
    const r = await asStaff((tx) =>
      changeTenant(tx, { ...base(), date: "2026-03-20", endCurrent: true, newCustomerId: null, components: [], readings: [{ meterId: a.meter, reading: 1055 }] }),
    );
    expect(r.eventId).toBeTruthy();
    const [c] = await asStaff((tx) => tx.query<{ ends_on: string }>("select ends_on::text from ml_contracts where role = 'tenant'", []));
    expect(c.ends_on).toBe("2026-03-20");
  });
});
