import type { Sql } from "@/lib/db/types";
import { ROUND_EARLY_DAYS } from "./links";
import { parseReading } from "./checks";
import { recordReading, type ReadingSource } from "./record";

export interface RoundSheetRow {
  meter_id: string;
  meter_number: string | null;
  read_method: "remote" | "mechanical";
  property_id: string;
  street_address: string;
  legacy_id: string | null;
  area_name: string | null;
  previous_reading: string | null;
  previous_read_on: string | null;
  round_reading: string | null;
  round_read_on: string | null;
  round_status: string | null;
}

/**
 * Kierroksen lukulista: käytössä olevat mittarit alueittain ja osoitteen
 * mukaan, edellinen hyväksytty lukema ennen kierrosta ja kierroksella jo
 * kirjattu lukema (kierrokseen liitetty tai lukemapäivän tienoilla kirjattu).
 */
export function roundSheet(tx: Sql, input: { organizationId: string; roundId: string; targetDate: string; areaId?: string | null; q?: string | null }) {
  const q = input.q?.trim() ? `%${input.q.trim().toLowerCase()}%` : null;
  return tx.query<RoundSheetRow>(
    `select m.id as meter_id, m.meter_number, m.read_method, p.id as property_id, p.street_address, p.legacy_id, a.name as area_name,
            prev.reading::text as previous_reading, prev.read_on::text as previous_read_on,
            cur.reading::text as round_reading, cur.read_on::text as round_read_on, cur.status as round_status
       from ml_meters m
       join ml_connections k on k.id = m.connection_id
       join ml_properties p on p.id = k.property_id
       left join ml_areas a on a.id = p.area_id
       left join lateral (
         select r.reading, r.read_on, r.status from ml_readings r
          where r.meter_id = m.id and r.status <> 'rejected' and (r.round_id = $2 or r.read_on >= $3::date - $4::int)
          order by r.read_on desc limit 1) cur on true
       left join lateral (
         select r.reading, r.read_on from ml_readings r
          where r.meter_id = m.id and r.status = 'accepted' and r.read_on < $3::date - $4::int
          order by r.read_on desc limit 1) prev on true
      where m.organization_id = $1 and m.removed_on is null
        and ($5::uuid is null or p.area_id = $5)
        and ($6::text is null or lower(p.street_address) like $6 or coalesce(p.legacy_id, '') like $6 or lower(coalesce(m.meter_number, '')) like $6)
      order by a.name nulls last, p.street_address, m.meter_number nulls last`,
    [input.organizationId, input.roundId, input.targetDate, ROUND_EARLY_DAYS, input.areaId ?? null, q],
  );
}

export interface BulkResult {
  saved: number;
  needsReview: number;
  errors: { meterId: string; message: string }[];
}

/**
 * Useamman lukeman kirjaus kerralla. Jokainen lukema tarkistetaan kuten
 * yksittäin kirjattu; virheellinen rivi ei estä muita. Kutsujan RLS rajaa,
 * mitä käyttäjä saa kirjata (mittarinlukija vain omissa nimissään).
 */
export async function recordBulkReadings(
  tx: Sql,
  input: { organizationId: string; userId: string; roundId: string; readOn: string; source: ReadingSource; entries: { meterId: string; value: string }[] },
): Promise<BulkResult> {
  const result: BulkResult = { saved: 0, needsReview: 0, errors: [] };
  for (const e of input.entries) {
    if (!e.value.trim()) continue;
    const value = parseReading(e.value);
    if (value === null) {
      result.errors.push({ meterId: e.meterId, message: "Lukema ei ole luku." });
      continue;
    }
    const clash = await tx.query("select 1 from ml_readings where meter_id = $1 and read_on = $2 and status <> 'rejected'", [e.meterId, input.readOn]);
    if (clash.length && input.source !== "staff") {
      result.errors.push({ meterId: e.meterId, message: "Mittarilla on jo lukema tälle päivälle." });
      continue;
    }
    const res = await recordReading(tx, {
      organizationId: input.organizationId, meterId: e.meterId, readOn: input.readOn, reading: value, source: input.source,
      userId: input.userId, roundId: input.roundId,
    });
    result.saved++;
    if (res.issues.length) result.needsReview++;
  }
  return result;
}
