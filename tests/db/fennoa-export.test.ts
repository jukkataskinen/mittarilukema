import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { approveBillingRun, createBillingRun, deleteDraftRun } from "@/lib/billing/run";
import { exportRunToFennoa } from "@/lib/fennoa/export";
import { FennoaError, mockFennoa, type FennoaClient } from "@/lib/fennoa";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
let runId = "";

const runner = (sub: string) => <T,>(fn: Parameters<Database["asUser"]>[1]) => db.asUser(sub, fn) as Promise<T>;
const dates = { invoiceDate: "2026-04-01", dueDate: "2026-04-15" };

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  await db.asService(async (tx) => {
    await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [a.id]);
    await tx.query(
      `insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values
         ($1, 'usage_fee', 'water', null, 'Vesi', 'm3', 0.95, '2024-09-01'),
         ($1, 'basic_fee', 'water', 'okt', 'Veden perusmaksu', 'month', 3.67, '2024-09-01')`,
      [a.id],
    );
    await tx.query(
      "insert into ml_readings (organization_id, meter_id, read_on, reading, source) values ($1, $2, '2025-09-30', 5657, 'import'), ($1, $2, '2026-03-31', 5710, 'import')",
      [a.id, a.meter],
    );
    // Laskukanavaa ei ole asetettu: vienti estetään.
    await tx.query("update ml_customers set billing_street = 'Testitie 1', billing_postal_code = '41800', billing_city = 'Korpilahti', email = null where id = $1", [a.customer]);
  });
  const run = await db.asUser(a.staff.sub, (tx) =>
    createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-09-30", periodEnd: "2026-03-31" }),
  );
  runId = run.runId;
});
afterAll(async () => {
  await db.close();
});

describe("vienti Fennoaan", () => {
  it("luonnoksen voi viedä testiympäristöön, ja poistettu luonnos vie vientitiedot mukanaan", async () => {
    const draft = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2025-03-31", periodEnd: "2025-09-30", note: "kokeilu" }),
    );
    const s = await exportRunToFennoa(runner(a.staff.sub), mockFennoa(), { organizationId: a.id, userId: a.staff.id, runId: draft.runId, ...dates });
    expect(s.blocked + s.exported).toBeGreaterThan(0);
    await db.asUser(a.staff.sub, (tx) => deleteDraftRun(tx, { organizationId: a.id, userId: a.staff.id, runId: draft.runId }));
    const rows = await db.asUser(a.staff.sub, (tx) => tx.query("select 1 from ml_fennoa_exports where run_id = $1", [draft.runId]));
    expect(rows).toHaveLength(0);
    await db.asUser(a.owner.sub, (tx) => approveBillingRun(tx, { organizationId: a.id, userId: a.owner.id, runId }));
  });

  it("asiakas ilman laskukanavaa estetään, eikä mitään lähetetä", async () => {
    const client = mockFennoa();
    const s = await exportRunToFennoa(runner(a.staff.sub), client, { organizationId: a.id, userId: a.staff.id, runId, ...dates });
    expect(s).toMatchObject({ exported: 0, blocked: 1 });
    expect(client.invoices.size).toBe(0);
    const [row] = await db.asUser(a.staff.sub, (tx) => tx.query<{ status: string; message: string }>("select status, message from ml_fennoa_exports where run_id = $1", [runId]));
    expect(row.status).toBe("blocked");
    expect(row.message).toMatch(/Laskukanava puuttuu/);
  });

  it("sähköpostiasiakas ilman sähköpostia estetään edelleen", async () => {
    await db.asService((tx) => tx.query("update ml_customers set invoice_channel = 'email' where id = $1", [a.customer]));
    const client = mockFennoa();
    const s = await exportRunToFennoa(runner(a.staff.sub), client, { organizationId: a.id, userId: a.staff.id, runId, ...dates });
    expect(s.blocked).toBe(1);
    expect(client.invoices.size).toBe(0);
  });

  it("Fennoan eri laskukanava tallentuu poikkeamaksi, eikä laskua viedä uudelleen", async () => {
    await db.asService((tx) => tx.query("update ml_customers set email = 'asiakas@example.fi' where id = $1", [a.customer]));
    // Fennoa, joka tallentaa kaikki laskut postitse lähteviksi.
    const inner = mockFennoa();
    const wrong: FennoaClient = {
      environment: "mock",
      addInvoice: (form) => inner.addInvoice(form),
      getInvoice: async (id) => ({ ...(await inner.getInvoice(id)), deliveryMethod: "postal" }),
    };
    const s = await exportRunToFennoa(runner(a.staff.sub), wrong, { organizationId: a.id, userId: a.staff.id, runId, ...dates });
    expect(s).toMatchObject({ mismatch: 1, exported: 0 });
    const [row] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ status: string; message: string; delivery_method: string }>("select status, message, delivery_method from ml_fennoa_exports where run_id = $1 and status = 'mismatch'", [runId]),
    );
    expect(row.delivery_method).toBe("email");
    expect(row.message).toMatch(/"postal", odotettiin "email"/);
    // Poikkeava lasku on jo Fennoassa: toinen vienti ei lähetä sitä.
    const again = mockFennoa();
    const s2 = await exportRunToFennoa(runner(a.staff.sub), again, { organizationId: a.id, userId: a.staff.id, runId, ...dates });
    expect(again.invoices.size).toBe(0);
    expect(s2).toMatchObject({ exported: 0, blocked: 0 });
  });

  it("oikea kanava viedään ja tarkistetaan takaisin luettuna", async () => {
    // Uusi ympäristö-ajo samasta laskusta: poistetaan poikkeama kuin se olisi korjattu ja kuitattu Fennoassa.
    await db.asService((tx) => tx.query("delete from ml_fennoa_exports where run_id = $1", [runId]));
    const client = mockFennoa();
    const s = await exportRunToFennoa(runner(a.staff.sub), client, { organizationId: a.id, userId: a.staff.id, runId, ...dates });
    expect(s).toMatchObject({ exported: 1, blocked: 0, mismatch: 0, failed: 0, remaining: 0 });
    const form = [...client.invoices.values()][0];
    expect(form).toMatchObject({ delivery_method: "email", einvoice_address: "asiakas@example.fi", invoice_date: "2026-04-01", due_date: "2026-04-15" });
    const [row] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ status: string; confirmed_delivery_method: string; gross_eur: string; confirmed_gross_eur: string }>(
        "select status, confirmed_delivery_method, gross_eur::text, confirmed_gross_eur::text from ml_fennoa_exports where run_id = $1",
        [runId],
      ),
    );
    expect(row).toMatchObject({ status: "exported", confirmed_delivery_method: "email" });
    expect(row.confirmed_gross_eur).toBe(row.gross_eur);
  });

  it("toinen organisaatio ei näe vientejä", async () => {
    const rows = await db.asUser(b.staff.sub, (tx) => tx.query("select 1 from ml_fennoa_exports"));
    expect(rows).toHaveLength(0);
  });
});

describe("epäonnistuneet laskut", () => {
  it("eivät tuki erää: yrittämättömät viedään ensin", async () => {
    const run = await db.asUser(b.staff.sub, async (tx) => {
      await tx.query("update ml_connections set fee_class = 'okt' where organization_id = $1", [b.id]);
      await tx.query("insert into ml_tariffs (organization_id, charge_type, connection_kind, fee_class, name, unit, price_eur, valid_from) values ($1, 'basic_fee', 'water', 'okt', 'Perusmaksu', 'month', 5, '2024-01-01')", [b.id]);
      // Kaksi maksajaa: ensimmäinen epäonnistuu Fennoassa, toinen onnistuu.
      const [p] = await tx.query<{ id: string }>("insert into ml_properties (organization_id, street_address) values ($1, 'Toinen tie 2') returning id", [b.id]);
      await tx.query("insert into ml_connections (organization_id, property_id, kind, connected_on, fee_class) values ($1, $2, 'water', '2010-01-01', 'okt')", [b.id, p.id]);
      const [c] = await tx.query<{ id: string }>(
        "insert into ml_customers (organization_id, name, email, invoice_channel, billing_street, billing_postal_code, billing_city) values ($1, 'Onnistuja', 'ok@example.fi', 'email', 'Tie 2', '41800', 'Korpilahti') returning id",
        [b.id],
      );
      await tx.query("insert into ml_contracts (organization_id, property_id, customer_id, role, starts_on) values ($1, $2, $3, 'owner', '2020-01-01')", [b.id, p.id, c.id]);
      await tx.query(
        "update ml_customers set email = 'fail@example.fi', invoice_channel = 'email', billing_street = 'Tie 1', billing_postal_code = '41800', billing_city = 'Korpilahti' where id = $1",
        [b.customer],
      );
      return createBillingRun(tx, { organizationId: b.id, userId: b.staff.id, periodStart: "2026-08-31", periodEnd: "2026-09-30", kind: "estimate" });
    });
    const inner = mockFennoa();
    // Ensimmäisenä yritetty lasku epäonnistuu aina (kuten puuttuva e-laskusopimus).
    let failing: string | null = null;
    const flaky: FennoaClient = {
      environment: "mock",
      addInvoice: async (form) => {
        failing ??= form.einvoice_address;
        if (form.einvoice_address === failing) throw new FennoaError("Fennoa: ei sopimusta", 422);
        return inner.addInvoice(form);
      },
      getInvoice: (id) => inner.getInvoice(id),
    };
    const input = { organizationId: b.id, userId: b.staff.id, runId: run.runId, ...dates, batch: 1 };
    const first = await exportRunToFennoa(runner(b.staff.sub), flaky, input);
    const second = await exportRunToFennoa(runner(b.staff.sub), flaky, input);
    expect(first).toMatchObject({ failed: 1, exported: 0 });
    // Toinen erä ottaa yrittämättömän laskun eikä samaa epäonnistunutta.
    expect(second).toMatchObject({ exported: 1, failed: 0 });
    expect(inner.invoices.size).toBe(1);
  });
});

describe("kanavan varmistus osoitteesta", () => {
  it("kun Fennoa ei palauta toimitustapaa, sama osoite varmistaa kanavan; eri osoite on poikkeama", async () => {
    const run = await db.asUser(a.staff.sub, (tx) =>
      createBillingRun(tx, { organizationId: a.id, userId: a.staff.id, periodStart: "2024-03-31", periodEnd: "2024-09-30", note: "osoitetesti" }),
    );
    const make = (match: boolean): FennoaClient => {
      const inner = mockFennoa();
      return {
        environment: "mock",
        addInvoice: (form) => inner.addInvoice(form),
        getInvoice: async (id) => ({ ...(await inner.getInvoice(id)), deliveryMethod: null, einvoiceMatch: match }),
      };
    };
    const input = { organizationId: a.id, userId: a.staff.id, runId: run.runId, ...dates };
    const bad = await exportRunToFennoa(runner(a.staff.sub), make(false), input);
    expect(bad).toMatchObject({ mismatch: 1, exported: 0 });
    await db.asService((tx) => tx.query("delete from ml_fennoa_exports where run_id = $1", [run.runId]));
    const ok = await exportRunToFennoa(runner(a.staff.sub), make(true), input);
    expect(ok).toMatchObject({ exported: 1, mismatch: 0 });
    const [row] = await db.asUser(a.staff.sub, (tx) => tx.query<{ message: string }>("select message from ml_fennoa_exports where run_id = $1", [run.runId]));
    expect(row.message).toMatch(/varmistettu Fennoan tallentamasta osoitteesta/);
  });
});
