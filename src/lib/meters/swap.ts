import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";

/**
 * Mittarinvaihto: vanha mittari poistetaan loppulukemalla ja uusi asennetaan
 * samalle liittymälle aloituslukemalla samana päivänä. Laskenta käyttää
 * vanhan mittarin kulutusta loppulukemaan asti ja uuden kulutusta
 * aloituslukemasta, joten vaihtoa varten ei tarvita erillistä lukemaa.
 * Vaihto kirjataan käyttöpaikan tapahtumaksi (ml_property_events).
 */

export class MeterSwapError extends Error {}

export const normalizeMeterNumber = (n: string | null | undefined) => (n ?? "").replace(/\s/g, "").toUpperCase();

export interface SwapMeterState {
  meterNumber: string | null;
  installedOn: string;
  startReading: number;
  /** Mittarin hyväksytyt ja tarkistettavat lukemat (ei hylättyjä). */
  readings: { readOn: string; reading: number; status: string }[];
}

export interface SwapInput {
  date: string;
  finalReading: number;
  newMeterNumber: string;
  startReading: number;
}

const fi = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};
const num = (n: number) => String(n).replace(".", ",");

/**
 * Vaihdon tarkistukset. Palauttaa ensimmäisen ongelman tai null. Samat säännöt
 * koskevat yksittäistä vaihtoa ja kampanjan riviä, jotta tulos ei riipu
 * kirjaustavasta.
 */
export function swapProblem(meter: SwapMeterState, input: SwapInput, today: string): string | null {
  if (input.date > today) return "Vaihtopäivä on tulevaisuudessa.";
  if (input.date < meter.installedOn) return `Vaihtopäivä on ennen vanhan mittarin asennusta (${fi(meter.installedOn)}).`;
  if (!input.newMeterNumber.trim()) return "Uuden mittarin numero puuttuu.";
  if (normalizeMeterNumber(input.newMeterNumber) === normalizeMeterNumber(meter.meterNumber)) return "Uusi mittarinumero on sama kuin vanha.";
  if (input.finalReading < 0 || input.startReading < 0) return "Lukema ei voi olla negatiivinen.";
  const after = meter.readings.filter((r) => r.readOn > input.date).sort((a, b) => a.readOn.localeCompare(b.readOn))[0];
  // Vaihdon jälkeen vanhalle mittarille kirjattu lukema on todennäköisesti uuden mittarin lukema väärässä paikassa.
  if (after) return `Vanhalle mittarille on kirjattu lukema vaihtopäivän jälkeen (${fi(after.readOn)}). Tarkista se ensin.`;
  const prev = [{ readOn: meter.installedOn, reading: meter.startReading, status: "accepted" }, ...meter.readings]
    .filter((r) => r.status === "accepted" && r.readOn <= input.date)
    .sort((a, b) => b.readOn.localeCompare(a.readOn))[0];
  if (prev && input.finalReading < prev.reading) {
    return `Loppulukema ${num(input.finalReading)} on pienempi kuin edellinen hyväksytty lukema ${num(prev.reading)} (${fi(prev.readOn)}).`;
  }
  return null;
}

export async function loadSwapMeter(tx: Sql, orgId: string, meterId: string) {
  const [m] = await tx.query<{
    id: string; connection_id: string; property_id: string; meter_number: string | null; installed_on: string; start_reading: string;
    removed_on: string | null; location: string | null; multiplier: string; readings: { d: string; r: string; s: string }[] | null;
  }>(
    `select m.id, m.connection_id, k.property_id, m.meter_number, m.installed_on::text, m.start_reading::text, m.removed_on::text, m.location,
            m.multiplier::text,
            (select json_agg(json_build_object('d', r.read_on::text, 'r', r.reading::text, 's', r.status))
               from ml_readings r where r.meter_id = m.id and r.status <> 'rejected') as readings
       from ml_meters m join ml_connections k on k.id = m.connection_id
      where m.organization_id = $1 and m.id = $2`,
    [orgId, meterId],
  );
  if (!m) return null;
  const state: SwapMeterState = {
    meterNumber: m.meter_number, installedOn: m.installed_on, startReading: Number(m.start_reading),
    readings: (m.readings ?? []).map((r) => ({ readOn: r.d, reading: Number(r.r), status: r.s })),
  };
  return { ...m, state };
}

export async function swapMeter(
  tx: Sql,
  input: SwapInput & {
    organizationId: string; userId: string; oldMeterId: string; today: string;
    readMethod: "remote" | "mechanical";
    /** Kerroin uudelle mittarille; oletuksena sama kuin vanhalla. */
    multiplier?: number | null;
    location?: string | null;
    source: "staff" | "campaign";
    batchId?: string | null;
    notes?: string | null;
  },
): Promise<{ newMeterId: string; propertyId: string }> {
  const old = await loadSwapMeter(tx, input.organizationId, input.oldMeterId);
  if (!old) throw new MeterSwapError("Vanhaa mittaria ei löytynyt.");
  if (old.removed_on) throw new MeterSwapError(`Mittari on jo poistettu käytöstä ${fi(old.removed_on)}.`);
  const problem = swapProblem(old.state, input, input.today);
  if (problem) throw new MeterSwapError(problem);
  const taken = await tx.query(
    "select 1 from ml_meters where organization_id = $1 and removed_on is null and upper(regexp_replace(coalesce(meter_number, ''), '\\s', '', 'g')) = $2",
    [input.organizationId, normalizeMeterNumber(input.newMeterNumber)],
  );
  if (taken.length) throw new MeterSwapError("Uusi mittarinumero on jo käytössä toisella mittarilla.");

  await tx.query("update ml_meters set removed_on = $2, final_reading = $3 where id = $1", [old.id, input.date, input.finalReading]);
  const [created] = await tx.query<{ id: string }>(
    `insert into ml_meters (organization_id, connection_id, meter_number, read_method, location, installed_on, start_reading, multiplier)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      input.organizationId, old.connection_id, input.newMeterNumber.trim(), input.readMethod, input.location ?? old.location, input.date, input.startReading,
      input.multiplier ?? Number(old.multiplier),
    ],
  );
  const [event] = await tx.query<{ id: string }>(
    `insert into ml_property_events (organization_id, property_id, kind, event_date, details, notes, created_by)
     values ($1, $2, 'meter_change', $3, $4, $5, $6) returning id`,
    [
      input.organizationId, old.property_id, input.date,
      JSON.stringify({
        oldMeterId: old.id, newMeterId: created.id, oldMeterNumber: old.meter_number, newMeterNumber: input.newMeterNumber.trim(),
        finalReading: input.finalReading, startReading: input.startReading, readMethod: input.readMethod, source: input.source, batchId: input.batchId ?? null,
      }),
      input.notes ?? null, input.userId,
    ],
  );
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "meter.swap", entity: "ml_property_events", entityId: event.id,
    details: { oldMeterId: old.id, newMeterId: created.id, source: input.source },
  });
  return { newMeterId: created.id, propertyId: old.property_id };
}
