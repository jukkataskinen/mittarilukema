import type { Database, Sql } from "@/lib/db/types";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { audit } from "@/lib/audit";
import { parseReading } from "./checks";
import { recordReading } from "./record";

/** Linkki on voimassa kierroksen määräpäivän jälkeen näin monta päivää. */
export const LINK_GRACE_DAYS = 14;

export interface CreatedLink {
  meterId: string;
  meterNumber: string | null;
  streetAddress: string;
  city: string | null;
  legacyId: string | null;
  customerName: string | null;
  customerNumber: string | null;
  phone: string | null;
  token: string;
}

/**
 * Linkit kierroksen kaikille käytössä oleville mittareille. Token palautetaan
 * vain tässä: kantaan menee tiiviste. Uudelleenluonti korvaa aiemmat linkit,
 * joten tiedosto on ladattava ja lähetettävä samasta luonnista.
 */
export async function createRoundLinks(tx: Sql, input: { organizationId: string; userId: string; roundId: string }): Promise<CreatedLink[]> {
  const [round] = await tx.query<{ due_date: string; status: string }>(
    "select due_date::text, status from ml_reading_rounds where id = $1 and organization_id = $2",
    [input.roundId, input.organizationId],
  );
  if (!round) throw new Error("Kierrosta ei löytynyt.");
  if (round.status !== "open") throw new Error("Kierros on suljettu.");

  const meters = await tx.query<{
    meter_id: string; meter_number: string | null; street_address: string; city: string | null; legacy_id: string | null;
    customer_name: string | null; customer_number: string | null; phone: string | null;
  }>(
    `select m.id as meter_id, m.meter_number, p.street_address, p.city, p.legacy_id,
            cu.name as customer_name, cu.customer_number, cu.phone
       from ml_meters m
       join ml_connections k on k.id = m.connection_id
       join ml_properties p on p.id = k.property_id
       left join lateral (
         select c.customer_id from ml_contracts c
          where c.property_id = p.id and c.billed and c.starts_on <= current_date and (c.ends_on is null or c.ends_on >= current_date)
          limit 1) c on true
       left join ml_customers cu on cu.id = c.customer_id
      where m.organization_id = $1 and m.removed_on is null
      order by p.street_address`,
    [input.organizationId],
  );

  const expires = new Date(Date.parse(`${round.due_date}T23:59:59+03:00`) + LINK_GRACE_DAYS * 86_400_000).toISOString();
  const out: CreatedLink[] = [];
  const rows = meters.map((m) => {
    const token = randomToken(24);
    out.push({
      meterId: m.meter_id, meterNumber: m.meter_number, streetAddress: m.street_address, city: m.city, legacyId: m.legacy_id,
      customerName: m.customer_name, customerNumber: m.customer_number, phone: m.phone, token,
    });
    return { meter_id: m.meter_id, token_hash: sha256Hex(token) };
  });
  if (rows.length) {
    await tx.query(
      `insert into ml_reading_links (organization_id, round_id, meter_id, token_hash, expires_at, created_by)
       select $1, $2, x.meter_id, x.token_hash, $3, $4 from json_to_recordset($5::json) as x(meter_id uuid, token_hash text)
       on conflict (round_id, meter_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
              created_by = excluded.created_by, created_at = now()`,
      [input.organizationId, input.roundId, expires, input.userId, JSON.stringify(rows)],
    );
  }
  await audit(tx, {
    organizationId: input.organizationId, userId: input.userId, action: "reading_links.create", entity: "ml_reading_rounds",
    entityId: input.roundId, details: { links: rows.length },
  });
  return out;
}

export interface LinkView {
  linkId: string;
  organizationId: string;
  organizationName: string;
  meterId: string;
  roundId: string;
  roundName: string;
  targetDate: string;
  meterNumber: string | null;
  streetAddress: string;
  previous: { reading: number; readOn: string } | null;
  submitted: { reading: number; readOn: string } | null;
}

/**
 * Linkin tiedot palvelun roolilla (kirjautumaton käyttäjä). Palauttaa null,
 * jos linkkiä ei ole, se on vanhentunut tai kierros on suljettu; syytä ei
 * kerrota, jottei linkkejä voi kokeilla.
 */
export async function resolveLink(tx: Sql, token: string): Promise<LinkView | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [l] = await tx.query<{
    id: string; organization_id: string; organization_name: string; meter_id: string; round_id: string; round_name: string;
    target_date: string; meter_number: string | null; street_address: string; reading_id: string | null;
  }>(
    `select l.id, l.organization_id, o.name as organization_name, l.meter_id, l.round_id, r.name as round_name, r.target_date::text,
            m.meter_number, p.street_address, l.reading_id
       from ml_reading_links l
       join ml_reading_rounds r on r.id = l.round_id
       join ml_organizations o on o.id = l.organization_id
       join ml_meters m on m.id = l.meter_id
       join ml_connections k on k.id = m.connection_id
       join ml_properties p on p.id = k.property_id
      where l.token_hash = $1 and l.expires_at > now() and r.status = 'open' and m.removed_on is null`,
    [sha256Hex(token)],
  );
  if (!l) return null;
  const [prev] = await tx.query<{ reading: string; read_on: string }>(
    `select reading::text, read_on::text from ml_readings
      where meter_id = $1 and status = 'accepted' and ($2::uuid is null or id <> $2)
      order by read_on desc limit 1`,
    [l.meter_id, l.reading_id],
  );
  const [sub] = l.reading_id
    ? await tx.query<{ reading: string; read_on: string }>("select reading::text, read_on::text from ml_readings where id = $1 and status <> 'rejected'", [l.reading_id])
    : [];
  return {
    linkId: l.id, organizationId: l.organization_id, organizationName: l.organization_name, meterId: l.meter_id, roundId: l.round_id,
    roundName: l.round_name, targetDate: l.target_date, meterNumber: l.meter_number, streetAddress: l.street_address,
    previous: prev ? { reading: Number(prev.reading), readOn: prev.read_on } : null,
    submitted: sub ? { reading: Number(sub.reading), readOn: sub.read_on } : null,
  };
}

export class LinkError extends Error {}

/**
 * Lukeman ilmoitus linkillä. Uusi ilmoitus samalla linkillä korvaa edellisen
 * (asiakas korjaa näppäilyvirheen). Toimiston saman päivän lukemaa ei korvata.
 */
export async function submitLinkReading(db: Database, token: string, input: { reading: string; readOn: string }): Promise<{ issues: string[] }> {
  const value = parseReading(input.reading);
  if (value === null) throw new LinkError("Lukema on luku, jossa on enintään kolme desimaalia.");
  return db.asService(async (tx) => {
    const link = await resolveLink(tx, token);
    if (!link) throw new LinkError("Linkki ei ole enää voimassa.");
    const [existing] = await tx.query<{ reading_id: string | null }>("select reading_id from ml_reading_links where id = $1 for update", [link.linkId]);
    if (existing.reading_id) {
      await tx.query("update ml_readings set status = 'rejected', note = 'Korvattu asiakkaan korjaamalla lukemalla' where id = $1 and source = 'form'", [existing.reading_id]);
    }
    const clash = await tx.query("select 1 from ml_readings where meter_id = $1 and read_on = $2 and status <> 'rejected'", [link.meterId, input.readOn]);
    if (clash.length) throw new LinkError("Mittarille on jo kirjattu lukema tälle päivälle. Ota tarvittaessa yhteyttä laitokseen.");
    const res = await recordReading(tx, {
      organizationId: link.organizationId, meterId: link.meterId, readOn: input.readOn, reading: value, source: "form", userId: null, roundId: link.roundId,
    });
    await tx.query("update ml_reading_links set reading_id = $2, used_at = now() where id = $1", [link.linkId, res.id]);
    await tx.query(
      "insert into ml_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'reading.form', 'ml_readings', $2, $3)",
      [link.organizationId, res.id, JSON.stringify({ link: link.linkId })],
    );
    return { issues: res.issues };
  });
}
