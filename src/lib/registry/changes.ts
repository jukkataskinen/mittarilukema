import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { recordReading } from "@/lib/readings/record";
import type { TenantComponent } from "@/lib/billing/parties";

/**
 * Käyttöpaikan osapuolten vaihdokset ohjattuina toimintoina (DECISIONS 26.9.2026).
 *
 * Vaihtopäivä on lähtevän osapuolen viimeinen päivä: hänen sopimuksensa
 * päättyy vaihtopäivään, uusi alkaa seuraavana päivänä ja lukema kirjataan
 * vaihtopäivälle. Laskutusajo jakaa kulutuksen tällä lukemalla ja tekee
 * lähtevälle loppulaskun seuraavassa ajossa. Kuukausimaksut vaihtuvat
 * vaihtoa seuraavan kuun alusta.
 *
 * Kaikki vaiheet tehdään samassa transaktiossa: joko koko vaihdos kirjautuu
 * tai ei mitään, eikä käyttöpaikalle jää puolikasta tilaa.
 */

export class ChangeError extends Error {}

const DAY = 86_400_000;
const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + DAY).toISOString().slice(0, 10);

export interface MeterReadingInput {
  meterId: string;
  reading: number;
}

/** Vaihtopäivänä käytössä olevat mittarit: näiltä kaikilta tarvitaan lukema. */
export async function metersOn(tx: Sql, propertyId: string, date: string) {
  return tx.query<{ id: string; meter_number: string | null; kind: "water" | "wastewater"; last_reading: string | null; last_read_on: string | null }>(
    `select m.id, m.meter_number, k.kind, r.reading::text as last_reading, r.read_on::text as last_read_on
       from ml_meters m
       join ml_connections k on k.id = m.connection_id
       left join lateral (select reading, read_on from ml_readings where meter_id = m.id and status = 'accepted' and read_on <= $2
                           order by read_on desc limit 1) r on true
      where k.property_id = $1 and k.connected_on <= $2 and (k.disconnected_on is null or k.disconnected_on > $2)
        and m.installed_on <= $2 and (m.removed_on is null or m.removed_on > $2)
      order by k.kind, m.meter_number`,
    [propertyId, date],
  );
}

async function recordChangeReadings(
  tx: Sql,
  input: { organizationId: string; userId: string; propertyId: string; date: string; readings: MeterReadingInput[]; note: string },
) {
  const meters = await metersOn(tx, input.propertyId, input.date);
  const given = new Map(input.readings.map((r) => [r.meterId, r.reading]));
  // Lukema on pakollinen: ilman sitä kulutusta ei voi jakaa osapuolille.
  const missing = meters.filter((m) => !given.has(m.id));
  if (missing.length) throw new ChangeError("Anna vaihtopäivän lukema kaikille käytössä oleville mittareille.");
  const ids: string[] = [];
  let needsReview = 0;
  for (const m of meters) {
    const r = await recordReading(tx, {
      organizationId: input.organizationId, meterId: m.id, readOn: input.date, reading: given.get(m.id)!, source: "staff", userId: input.userId,
      note: input.note,
    });
    ids.push(r.id);
    if (r.issues.length) needsReview++;
  }
  return { ids, needsReview };
}

async function activeContract(tx: Sql, propertyId: string, role: "owner" | "tenant", date: string) {
  const [c] = await tx.query<{ id: string; customer_id: string; starts_on: string }>(
    `select id, customer_id, starts_on::text from ml_contracts
      where property_id = $1 and role = $2 and billed and starts_on <= $3 and (ends_on is null or ends_on >= $3)`,
    [propertyId, role, date],
  );
  return c ?? null;
}

async function laterContracts(tx: Sql, propertyId: string, role: "owner" | "tenant", date: string) {
  const rows = await tx.query("select 1 from ml_contracts where property_id = $1 and role = $2 and billed and starts_on > $3", [propertyId, role, date]);
  return rows.length > 0;
}

export type LoanDecision = "stays_with_seller" | "transfers";

export async function changeOwner(
  tx: Sql,
  input: {
    organizationId: string; userId: string; propertyId: string;
    /** Myyjän viimeinen päivä ja lukemapäivä. */
    date: string;
    newCustomerId: string;
    readings: MeterReadingInput[];
    /** Pakollinen, jos käyttöpaikalla on lainaa jäljellä. */
    loanDecision: LoanDecision | null;
    endTenant: boolean;
    notes?: string | null;
  },
): Promise<{ eventId: string; needsReview: number }> {
  const seller = await activeContract(tx, input.propertyId, "owner", input.date);
  if (!seller) throw new ChangeError("Käyttöpaikalla ei ole vaihtopäivänä voimassa olevaa liittymissopimusta. Kirjaa omistaja sopimuksena.");
  if (seller.customer_id === input.newCustomerId) throw new ChangeError("Uusi omistaja on sama kuin nykyinen.");
  if (seller.starts_on > input.date) throw new ChangeError("Vaihtopäivä on ennen nykyisen omistajan sopimuksen alkua.");
  if (await laterContracts(tx, input.propertyId, "owner", input.date)) {
    throw new ChangeError("Käyttöpaikalle on jo kirjattu vaihtopäivän jälkeen alkava liittymissopimus.");
  }
  const loans = await tx.query<{ id: string; debtor_customer_id: string | null }>(
    "select id, debtor_customer_id from ml_property_loans where property_id = $1 and balance_eur > 0",
    [input.propertyId],
  );
  if (loans.length && !input.loanDecision) throw new ChangeError("Käyttöpaikalla on lainaa. Valitse, siirtyykö laina ostajalle vai jääkö se myyjälle.");

  const { ids: readingIds, needsReview } = await recordChangeReadings(tx, { ...input, note: "Omistajanvaihdos" });

  await tx.query("update ml_contracts set ends_on = $2 where id = $1", [seller.id, input.date]);
  const [buyer] = await tx.query<{ id: string }>(
    "insert into ml_contracts (organization_id, property_id, customer_id, role, billed, starts_on) values ($1, $2, $3, 'owner', true, $4) returning id",
    [input.organizationId, input.propertyId, input.newCustomerId, addDay(input.date)],
  );

  // Laina peritään myyjältä, kunnes kauppakirja osoittaa sen siirtyneen.
  // Jo aiemmin muulle velalliselle kirjattua lainaa ei muuteta.
  if (loans.length) {
    const debtor = input.loanDecision === "stays_with_seller" ? seller.customer_id : null;
    await tx.query("update ml_property_loans set debtor_customer_id = $2 where property_id = $1 and balance_eur > 0 and debtor_customer_id is null", [
      input.propertyId,
      debtor,
    ]);
  }

  let endedTenant: string | null = null;
  if (input.endTenant) {
    const tenant = await activeContract(tx, input.propertyId, "tenant", input.date);
    if (tenant) {
      await tx.query("update ml_contracts set ends_on = $2 where id = $1", [tenant.id, input.date]);
      endedTenant = tenant.id;
    }
  }

  const [event] = await tx.query<{ id: string }>(
    `insert into ml_property_events (organization_id, property_id, kind, event_date, details, notes, created_by)
     values ($1, $2, 'ownership_change', $3, $4, $5, $6) returning id`,
    [
      input.organizationId, input.propertyId, input.date,
      JSON.stringify({
        fromCustomerId: seller.customer_id, toCustomerId: input.newCustomerId, fromContractId: seller.id, toContractId: buyer.id,
        readingIds, loanDecision: loans.length ? input.loanDecision : null, endedTenantContractId: endedTenant,
      }),
      input.notes ?? null, input.userId,
    ],
  );
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "property.ownership_change", entity: "ml_property_events", entityId: event.id,
    details: { propertyId: input.propertyId, date: input.date, loans: loans.length, loanDecision: input.loanDecision },
  });
  return { eventId: event.id, needsReview };
}

export async function changeTenant(
  tx: Sql,
  input: {
    organizationId: string; userId: string; propertyId: string;
    /** Lähtevän vuokralaisen viimeinen päivä ja lukemapäivä; uusi aloittaa seuraavana päivänä. */
    date: string;
    endCurrent: boolean;
    newCustomerId: string | null;
    components: TenantComponent[];
    readings: MeterReadingInput[];
    notes?: string | null;
  },
): Promise<{ eventId: string; needsReview: number }> {
  if (!input.endCurrent && !input.newCustomerId) throw new ChangeError("Valitse, päättyykö nykyinen käyttösopimus tai kuka on uusi vuokralainen.");
  if (input.newCustomerId && input.components.length === 0) throw new ChangeError("Valitse käyttösopimukseen ainakin yksi vuokralaisen maksama osa.");
  const current = await activeContract(tx, input.propertyId, "tenant", input.date);
  if (input.endCurrent && !current) throw new ChangeError("Käyttöpaikalla ei ole vaihtopäivänä voimassa olevaa käyttösopimusta.");
  if (input.newCustomerId && current && !input.endCurrent) {
    throw new ChangeError("Käyttöpaikalla on jo vuokralainen. Päätä nykyinen käyttösopimus samalla.");
  }
  if (current && input.newCustomerId === current.customer_id) throw new ChangeError("Uusi vuokralainen on sama kuin nykyinen.");
  if (await laterContracts(tx, input.propertyId, "tenant", input.date)) {
    throw new ChangeError("Käyttöpaikalle on jo kirjattu vaihtopäivän jälkeen alkava käyttösopimus.");
  }
  const owner = await activeContract(tx, input.propertyId, "owner", addDay(input.date));
  if (input.newCustomerId && owner?.customer_id === input.newCustomerId) throw new ChangeError("Omistaja ei voi olla oman käyttöpaikkansa vuokralainen.");

  const { ids: readingIds, needsReview } = await recordChangeReadings(tx, { ...input, note: "Vuokralaisen vaihdos" });

  if (input.endCurrent && current) await tx.query("update ml_contracts set ends_on = $2 where id = $1", [current.id, input.date]);
  let newContract: string | null = null;
  if (input.newCustomerId) {
    const [c] = await tx.query<{ id: string }>(
      `insert into ml_contracts (organization_id, property_id, customer_id, role, billed, starts_on, tenant_components)
       values ($1, $2, $3, 'tenant', true, $4, $5) returning id`,
      [input.organizationId, input.propertyId, input.newCustomerId, addDay(input.date), input.components],
    );
    newContract = c.id;
  }

  const [event] = await tx.query<{ id: string }>(
    `insert into ml_property_events (organization_id, property_id, kind, event_date, details, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      input.organizationId, input.propertyId, input.newCustomerId ? "tenant_in" : "tenant_out", input.date,
      JSON.stringify({
        fromCustomerId: input.endCurrent ? (current?.customer_id ?? null) : null, toCustomerId: input.newCustomerId,
        fromContractId: input.endCurrent ? (current?.id ?? null) : null, toContractId: newContract, components: input.newCustomerId ? input.components : null,
        readingIds,
      }),
      input.notes ?? null, input.userId,
    ],
  );
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "property.tenant_change", entity: "ml_property_events", entityId: event.id,
    details: { propertyId: input.propertyId, date: input.date },
  });
  return { eventId: event.id, needsReview };
}

/** Kauppakirja osoittaa lainan siirtyneen: laina laskutetaan tästä eteenpäin omistajalta. */
export async function confirmLoanTransfer(tx: Sql, input: { organizationId: string; userId: string; loanId: string }): Promise<boolean> {
  const rows = await tx.query<{ id: string; debtor_customer_id: string }>(
    `update ml_property_loans l set debtor_customer_id = null
       from (select id, debtor_customer_id from ml_property_loans where id = $1) old
      where l.id = old.id and l.organization_id = $2 and old.debtor_customer_id is not null
      returning l.id, old.debtor_customer_id`,
    [input.loanId, input.organizationId],
  );
  if (!rows.length) return false;
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "loan.transfer_confirmed", entity: "ml_property_loans", entityId: input.loanId,
    details: { previousDebtor: rows[0].debtor_customer_id },
  });
  return true;
}

export const EVENT_KIND: Record<string, string> = {
  ownership_change: "Omistajanvaihdos",
  tenant_in: "Vuokralainen muutti",
  tenant_out: "Vuokralainen muutti pois",
  meter_change: "Mittarinvaihto",
};
