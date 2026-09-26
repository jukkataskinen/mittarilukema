import type { Database, Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { parseReading } from "@/lib/readings/checks";
import { normalizePhone } from "@/lib/validation/phone";

/**
 * Asiakkaan muutosilmoitukset (0023). Julkinen lomake tallentaa ilmoituksen
 * palvelutunnuksilla organisaation lomaketunnuksen perusteella. Toimisto
 * kohdistaa sen käyttöpaikkaan ja käsittelee sen vaihdostoiminnoilla.
 */

export type ChangeKind = "sale" | "move_in" | "move_out" | "billing" | "other";
export const CHANGE_KINDS: ChangeKind[] = ["sale", "move_in", "move_out", "billing", "other"];

/** Julkisen lomakkeen lajit: osoitteen ?laji=… ja otsikot. */
export const KIND_SLUG: Record<ChangeKind, string> = { sale: "kauppa", move_in: "muutto-sisaan", move_out: "muutto-pois", billing: "laskutus", other: "muu" };
export const KIND_LABEL: Record<ChangeKind, string> = {
  sale: "Kiinteistö on myyty",
  move_in: "Vuokralainen muuttaa sisään",
  move_out: "Vuokralainen muuttaa pois",
  billing: "Laskutusosoite tai yhteystiedot muuttuvat",
  other: "Muu asia",
};
export const KIND_SHORT: Record<ChangeKind, string> = {
  sale: "Kauppa", move_in: "Muutto sisään", move_out: "Muutto pois", billing: "Laskutustiedot", other: "Muu",
};
export const REQUEST_STATUS: Record<string, { label: string; tone: "info" | "warn" | "ok" | "neutral" }> = {
  new: { label: "Uusi", tone: "info" },
  in_progress: { label: "Käsittelyssä", tone: "warn" },
  done: { label: "Käsitelty", tone: "ok" },
  rejected: { label: "Hylätty", tone: "neutral" },
};
export const ROLE_LABEL: Record<string, string> = { seller: "Myyjä", buyer: "Ostaja", owner: "Omistaja", tenant: "Vuokralainen", other: "Muu" };
export const LOAN_LABEL: Record<string, string> = { transfers: "Siirtyy ostajalle", stays: "Jää myyjälle", unknown: "Ei tiedossa" };

export class ChangeRequestError extends Error {}

/** Lähetysrajat: yhdestä osoitteesta tunnissa ja organisaatiolle vuorokaudessa. */
export const LIMIT_PER_IP_HOUR = 5;
export const LIMIT_PER_ORG_DAY = 200;

export interface ChangeRequestInput {
  kind: ChangeKind;
  changeDate: string | null;
  placeText: string;
  submitterName: string;
  submitterRole: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  partyName: string | null;
  partyEmail: string | null;
  partyPhone: string | null;
  partyAddress: string | null;
  otherName: string | null;
  loanAnswer: "transfers" | "stays" | "unknown" | null;
  meterNumber: string | null;
  reading: number | null;
  message: string | null;
}

const text = (v: FormDataEntryValue | null | undefined, max: number) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s ? s.slice(0, max) : null;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Henkilötunnusta ei käsitellä (CLAUDE.md): tunnistetaan muoto ja pyydetään poistamaan.
const HETU = /\b\d{6}[-+A-FU-Y]\d{3}[0-9A-Y]\b/i;

/**
 * Lomakkeen tarkistus lajin mukaan. Palauttaa ensimmäisen virheen, jotta
 * asiakas saa yhden selkeän ohjeen kerrallaan.
 */
export function parseChangeRequest(kind: ChangeKind, get: (name: string) => FormDataEntryValue | null, today: string): ChangeRequestInput | string {
  const v: ChangeRequestInput = {
    kind,
    changeDate: text(get("changeDate"), 10),
    placeText: text(get("placeText"), 200) ?? "",
    submitterName: text(get("submitterName"), 200) ?? "",
    submitterRole: text(get("submitterRole"), 20),
    submitterEmail: text(get("submitterEmail"), 200),
    submitterPhone: text(get("submitterPhone"), 40),
    partyName: text(get("partyName"), 200),
    partyEmail: text(get("partyEmail"), 200),
    partyPhone: text(get("partyPhone"), 40),
    partyAddress: text(get("partyAddress"), 300),
    otherName: text(get("otherName"), 200),
    loanAnswer: null,
    meterNumber: text(get("meterNumber"), 60),
    reading: null,
    message: typeof get("message") === "string" ? (get("message") as string).trim().slice(0, 2000) || null : null,
  };
  const all = Object.values(v).filter((x) => typeof x === "string").join(" ");
  if (HETU.test(all)) return "Älä kirjoita lomakkeelle henkilötunnusta. Poista se ja lähetä uudelleen.";
  if (!v.placeText) return "Kerro käyttöpaikan osoite.";
  if (!v.submitterName) return "Kerro nimesi.";
  if (!v.submitterEmail && !v.submitterPhone) return "Anna sähköpostiosoite tai puhelinnumero, jotta voimme tarvittaessa ottaa yhteyttä.";
  for (const e of [v.submitterEmail, v.partyEmail]) if (e && !EMAIL.test(e)) return "Tarkista sähköpostiosoite.";
  for (const [key, p] of [["submitterPhone", v.submitterPhone], ["partyPhone", v.partyPhone]] as const) {
    if (p) {
      const n = normalizePhone(p);
      if (!n) return "Tarkista puhelinnumero, esimerkiksi 040 123 4567.";
      v[key] = n;
    }
  }
  if (v.submitterRole && !(v.submitterRole in ROLE_LABEL)) v.submitterRole = "other";

  const needsDate = kind === "sale" || kind === "move_in" || kind === "move_out";
  if (needsDate) {
    if (!v.changeDate || !/^\d{4}-\d{2}-\d{2}$/.test(v.changeDate)) return kind === "sale" ? "Anna luovutuspäivä." : "Anna muuttopäivä.";
    // Ilmoituksen voi tehdä etukäteen, mutta ei vuoden päähän eikä kovin vanhasta.
    const diff = (Date.parse(v.changeDate) - Date.parse(today)) / 86_400_000;
    if (diff > 180 || diff < -365) return "Tarkista päivämäärä.";
  } else v.changeDate = null;

  const reading = text(get("reading"), 20);
  if (reading) {
    const r = parseReading(reading);
    if (r === null) return "Tarkista mittarilukema: anna pelkkä luku, esimerkiksi 1234,5.";
    v.reading = r;
  }
  if (kind === "sale") {
    if (!v.partyName) return "Kerro ostajan nimi.";
    const loan = text(get("loanAnswer"), 20);
    v.loanAnswer = loan === "transfers" || loan === "stays" ? loan : "unknown";
  }
  if (kind === "move_in" && !v.partyName) return "Kerro vuokralaisen nimi.";
  if (kind === "billing" && !v.partyAddress && !v.partyEmail && !v.partyPhone) return "Kerro uusi laskutusosoite tai yhteystieto.";
  if (kind === "other" && !v.message) return "Kirjoita viesti.";
  return v;
}

export async function orgByFormToken(db: Database, token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const [org] = await db.asService((tx) =>
    tx.query<{ id: string; name: string; contact_email: string | null; contact_phone: string | null }>(
      "select id, name, contact_email, contact_phone from ml_organizations where change_form_token = $1",
      [token],
    ),
  );
  return org ?? null;
}

export async function submitChangeRequest(db: Database, orgId: string, input: ChangeRequestInput, ipHash: string | null): Promise<string> {
  return db.asService(async (tx) => {
    if (ipHash) {
      const [{ n }] = await tx.query<{ n: number }>(
        "select count(*)::int as n from ml_change_requests where ip_hash = $1 and created_at > now() - interval '1 hour'",
        [ipHash],
      );
      if (n >= LIMIT_PER_IP_HOUR) throw new ChangeRequestError("Olet lähettänyt useita ilmoituksia lyhyessä ajassa. Yritä myöhemmin uudelleen tai ota yhteyttä puhelimitse.");
    }
    const [{ n: orgCount }] = await tx.query<{ n: number }>(
      "select count(*)::int as n from ml_change_requests where organization_id = $1 and created_at > now() - interval '1 day'",
      [orgId],
    );
    if (orgCount >= LIMIT_PER_ORG_DAY) throw new ChangeRequestError("Lomake on tilapäisesti ruuhkautunut. Yritä myöhemmin uudelleen tai ota yhteyttä puhelimitse.");
    const [row] = await tx.query<{ id: string }>(
      `insert into ml_change_requests (organization_id, kind, change_date, place_text, submitter_name, submitter_role, submitter_email, submitter_phone,
                                       party_name, party_email, party_phone, party_address, other_name, loan_answer, meter_number, reading, message, ip_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
      [
        orgId, input.kind, input.changeDate, input.placeText, input.submitterName, input.submitterRole, input.submitterEmail, input.submitterPhone,
        input.partyName, input.partyEmail, input.partyPhone, input.partyAddress, input.otherName, input.loanAnswer, input.meterNumber, input.reading,
        input.message, ipHash,
      ],
    );
    return row.id;
  });
}

export interface ChangeRequestRow {
  id: string;
  kind: ChangeKind;
  change_date: string | null;
  place_text: string;
  property_id: string | null;
  street_address: string | null;
  submitter_name: string;
  submitter_role: string | null;
  submitter_email: string | null;
  submitter_phone: string | null;
  party_name: string | null;
  party_email: string | null;
  party_phone: string | null;
  party_address: string | null;
  other_name: string | null;
  loan_answer: string | null;
  meter_number: string | null;
  reading: string | null;
  message: string | null;
  status: string;
  handled_at: string | null;
  handled_note: string | null;
  event_id: string | null;
  created_at: string;
}

export async function getChangeRequest(tx: Sql, orgId: string, id: string): Promise<ChangeRequestRow | null> {
  const [r] = await tx.query<ChangeRequestRow>(
    `select c.id, c.kind, c.change_date::text, c.place_text, c.property_id, p.street_address, c.submitter_name, c.submitter_role, c.submitter_email,
            c.submitter_phone, c.party_name, c.party_email, c.party_phone, c.party_address, c.other_name, c.loan_answer, c.meter_number,
            c.reading::text, c.message, c.status, c.handled_at, c.handled_note, c.event_id, c.created_at
       from ml_change_requests c left join ml_properties p on p.id = c.property_id
      where c.organization_id = $1 and c.id = $2`,
    [orgId, id],
  );
  return r ?? null;
}

export async function setRequestProperty(tx: Sql, input: { organizationId: string; userId: string; id: string; propertyId: string | null }) {
  const rows = await tx.query(
    `update ml_change_requests set property_id = $3, status = case when status = 'new' then 'in_progress' else status end
      where id = $1 and organization_id = $2 and status in ('new', 'in_progress') returning id`,
    [input.id, input.organizationId, input.propertyId],
  );
  if (rows.length) await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "change_request.link", entity: "ml_change_requests", entityId: input.id });
  return rows.length > 0;
}

export async function closeRequest(
  tx: Sql,
  input: { organizationId: string; userId: string; id: string; status: "done" | "rejected" | "in_progress"; note?: string | null; eventId?: string | null },
) {
  const rows = await tx.query(
    `update ml_change_requests set status = $3, handled_note = coalesce($4, handled_note), event_id = coalesce($5, event_id),
            handled_by = case when $3 = 'in_progress' then null else $6::uuid end, handled_at = case when $3 = 'in_progress' then null else now() end
      where id = $1 and organization_id = $2 returning id`,
    [input.id, input.organizationId, input.status, input.note ?? null, input.eventId ?? null, input.userId],
  );
  if (rows.length) {
    await audit(tx, {
      organizationId: input.organizationId, userId: input.userId, action: `change_request.${input.status}`, entity: "ml_change_requests", entityId: input.id,
    });
  }
  return rows.length > 0;
}

/** Vapaamuotoinen osoite ("Katu 1, 19650 Joutsa") kentiksi uuden asiakkaan esitäyttöön. */
export function splitAddress(text: string | null): { street: string | null; postalCode: string | null; city: string | null } {
  if (!text) return { street: null, postalCode: null, city: null };
  const m = /^(.*?)[,\s]+(\d{5})\s+(.+)$/.exec(text.trim());
  if (!m) return { street: text.trim(), postalCode: null, city: null };
  return { street: m[1].replace(/,$/, "").trim(), postalCode: m[2], city: m[3].trim() };
}

/** Avoin, käyttöpaikkaan kohdistettu ilmoitus vaihdoslomakkeen esitäyttöön. */
export async function openRequestFor(tx: Sql, orgId: string, requestId: string | undefined, propertyId: string) {
  if (!requestId || !/^[0-9a-f-]{36}$/.test(requestId)) return null;
  const r = await getChangeRequest(tx, orgId, requestId);
  if (!r || r.property_id !== propertyId || (r.status !== "new" && r.status !== "in_progress")) return null;
  const addr = splitAddress(r.party_address);
  return {
    request: r,
    party: r.party_name ? { name: r.party_name, email: r.party_email, phone: r.party_phone, ...addr } : null,
    reading: { reading: r.reading, meterNumber: r.meter_number },
  };
}
