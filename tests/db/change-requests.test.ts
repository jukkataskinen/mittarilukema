import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import {
  ChangeRequestError, closeRequest, LIMIT_PER_IP_HOUR, openRequestFor, orgByFormToken, parseChangeRequest, setRequestProperty, submitChangeRequest,
  type ChangeRequestInput,
} from "@/lib/change-requests";
import { changeOwner } from "@/lib/registry/changes";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Asiakkaan muutosilmoitukset (0023). */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
let token = "";

const input = (over: Record<string, string> = {}) =>
  parseChangeRequest(
    "sale",
    (n) =>
      ({ placeText: "Testitie 1, Joutsa", submitterName: "Myyjä", submitterEmail: "m@example.fi", changeDate: "2026-09-30", partyName: "Ostaja Oy",
        partyAddress: "Ostajankatu 2, 00100 Helsinki", reading: "150", ...over } as Record<string, string>)[n] ?? null,
    "2026-09-26",
  ) as ChangeRequestInput;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Laitos A");
  b = await seedOrg(db, "Laitos B");
  [{ change_form_token: token }] = await db.asService((tx) =>
    tx.query<{ change_form_token: string }>("select change_form_token from ml_organizations where id = $1", [a.id]),
  );
});
afterAll(async () => {
  await db.close();
});

describe("julkinen lomake", () => {
  it("tunnus löytää organisaation, arvattu ei", async () => {
    expect((await orgByFormToken(db, token))?.id).toBe(a.id);
    expect(await orgByFormToken(db, "0".repeat(32))).toBeNull();
    expect(await orgByFormToken(db, "../x")).toBeNull();
  });

  it("samasta osoitteesta rajallinen määrä ilmoituksia tunnissa", async () => {
    for (let i = 0; i < LIMIT_PER_IP_HOUR; i++) await submitChangeRequest(db, a.id, input(), "iphash-1");
    await expect(submitChangeRequest(db, a.id, input(), "iphash-1")).rejects.toThrow(ChangeRequestError);
    await submitChangeRequest(db, a.id, input(), "iphash-2");
  });

  it("toinen organisaatio ei näe ilmoituksia, mittarinlukija ei näe niitä lainkaan", async () => {
    const other = await db.asUser(b.staff.sub, (tx) => tx.query("select 1 from ml_change_requests", []));
    expect(other).toHaveLength(0);
    const reader = await db.asUser(a.reader.sub, (tx) => tx.query("select 1 from ml_change_requests", []));
    expect(reader).toHaveLength(0);
    const staff = await db.asUser(a.staff.sub, (tx) => tx.query("select 1 from ml_change_requests", []));
    expect(staff.length).toBe(LIMIT_PER_IP_HOUR + 1);
  });
});

describe("käsittely", () => {
  it("kohdistus, esitäyttö ja sulkeminen omistajanvaihdoksessa", async () => {
    const id = await submitChangeRequest(db, a.id, input(), null);
    await db.asUser(a.staff.sub, (tx) => setRequestProperty(tx, { organizationId: a.id, userId: a.staff.id, id, propertyId: a.property }));
    const pre = await db.asUser(a.staff.sub, (tx) => openRequestFor(tx, a.id, id, a.property));
    expect(pre?.party).toEqual({ name: "Ostaja Oy", email: null, phone: null, street: "Ostajankatu 2", postalCode: "00100", city: "Helsinki" });
    expect(pre?.reading).toEqual({ reading: "150.000", meterNumber: null });
    // Väärä käyttöpaikka ei esitäytä.
    expect(await db.asUser(a.staff.sub, (tx) => openRequestFor(tx, a.id, id, b.property))).toBeNull();

    await db.asUser(a.staff.sub, async (tx) => {
      const [c] = await tx.query<{ id: string }>("insert into ml_customers (organization_id, name) values ($1, 'Ostaja Oy') returning id", [a.id]);
      const res = await changeOwner(tx, {
        organizationId: a.id, userId: a.staff.id, propertyId: a.property, date: "2026-09-30", newCustomerId: c.id, readings: [{ meterId: a.meter, reading: 150 }],
        loanDecision: null, endTenant: false,
      });
      await closeRequest(tx, { organizationId: a.id, userId: a.staff.id, id, status: "done", eventId: res.eventId });
    });
    const [r] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ status: string; event_id: string | null }>("select status, event_id from ml_change_requests where id = $1", [id]),
    );
    expect(r.status).toBe("done");
    expect(r.event_id).toBeTruthy();
    // Käsitelty ilmoitus ei enää esitäytä eikä sitä voi kohdistaa uudelleen.
    expect(await db.asUser(a.staff.sub, (tx) => openRequestFor(tx, a.id, id, a.property))).toBeNull();
    expect(await db.asUser(a.staff.sub, (tx) => setRequestProperty(tx, { organizationId: a.id, userId: a.staff.id, id, propertyId: null }))).toBe(false);
  });
});
