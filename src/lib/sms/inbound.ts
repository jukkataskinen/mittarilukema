import type { Database } from "@/lib/db/types";
import { normalizePhone } from "@/lib/validation/phone";
import { recordReading } from "@/lib/readings/record";
import { parseSms } from "./parse";
import { ISSUE_LABEL } from "@/lib/readings/checks";

export interface InboundSms {
  from: string;
  to: string | null;
  body: string;
  receivedAt?: string;
  providerMessageId?: string | null;
}

export interface InboundResult {
  id: string;
  status: "recorded" | "needs_review" | "unmatched" | "duplicate";
  reply: string | null;
}

const fmt = (n: number) => String(n).replace(".", ",");
const dateOf = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date(iso));

/**
 * Saapuvan tekstiviestin käsittely palvelun roolilla (lähettäjä ei ole
 * kirjautunut). Viesti tallennetaan aina, jotta toimisto näkee myös
 * tulkitsemattomat. Lukema kirjataan vain, kun kaikki on yksiselitteistä:
 * numero kuuluu yhdelle asiakkaalle, jolla on yksi käytössä oleva mittari tai
 * viestissä on kiinteistön tunnus. Muuten viesti jää toimiston käsiteltäväksi.
 * Sama palveluntarjoajan viesti käsitellään vain kerran.
 */
export async function handleInboundSms(db: Database, sms: InboundSms): Promise<InboundResult> {
  const from = normalizePhone(sms.from) ?? sms.from.trim();
  const to = sms.to ? (normalizePhone(sms.to) ?? sms.to.trim()) : null;
  const receivedAt = sms.receivedAt ?? new Date().toISOString();

  return db.asService(async (tx) => {
    if (sms.providerMessageId) {
      const [dup] = await tx.query<{ id: string; reply: string | null }>("select id, reply from ml_inbound_sms where provider_message_id = $1", [sms.providerMessageId]);
      if (dup) return { id: dup.id, status: "duplicate", reply: null };
    }
    const save = async (row: { orgId: string | null; status: string; reason: string | null; customerId?: string | null; propertyId?: string | null; readingId?: string | null; reply: string | null }) => {
      const [r] = await tx.query<{ id: string }>(
        `insert into ml_inbound_sms (organization_id, provider_message_id, from_phone, to_phone, body, received_at, status, reason, customer_id, property_id, reading_id, reply)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [row.orgId, sms.providerMessageId ?? null, from, to, sms.body.slice(0, 1000), receivedAt, row.status, row.reason,
          row.customerId ?? null, row.propertyId ?? null, row.readingId ?? null, row.reply],
      );
      return r.id;
    };
    const unmatched = async (orgId: string | null, reason: string, customerId: string | null = null, reply: string | null = null): Promise<InboundResult> => ({
      id: await save({ orgId, status: "unmatched", reason, customerId, reply }),
      status: "unmatched",
      reply,
    });

    const [org] = to ? await tx.query<{ id: string }>("select id from ml_organizations where sms_number = $1", [to]) : [];
    if (!org) return unmatched(null, "Vastaanottajanumeroa ei tunnisteta.");

    const parsed = parseSms(sms.body);
    const customers = await tx.query<{ id: string }>("select id from ml_customers where organization_id = $1 and phone = $2", [org.id, from]);
    const askAgain = "Emme voineet kirjata lukemaa automaattisesti. Laitos käsittelee viestin.";
    if (customers.length === 0) return unmatched(org.id, "Lähettäjän numeroa ei ole asiakasrekisterissä.", null, askAgain);
    if (parsed.problem || parsed.reading === null) {
      return unmatched(org.id, parsed.problem ?? "Lukemaa ei tulkittu.", customers.length === 1 ? customers[0].id : null,
        "Emme tunnistaneet lukemaa. Lähetä pelkkä mittarin lukema numeroina, esimerkiksi 1234.");
    }

    const meters = await tx.query<{ meter_id: string; property_id: string; street_address: string; legacy_id: string | null; customer_id: string }>(
      `select distinct m.id as meter_id, p.id as property_id, p.street_address, p.legacy_id, c.customer_id
         from ml_contracts c
         join ml_properties p on p.id = c.property_id
         join ml_connections k on k.property_id = p.id and k.disconnected_on is null
         join ml_meters m on m.connection_id = k.id and m.removed_on is null
        where c.organization_id = $1 and c.customer_id = any($2::uuid[])
          and c.starts_on <= current_date and (c.ends_on is null or c.ends_on >= current_date)`,
      [org.id, customers.map((c) => c.id)],
    );
    const candidates = parsed.placeId ? meters.filter((m) => m.legacy_id === parsed.placeId) : meters;
    if (candidates.length !== 1) {
      const reason = candidates.length === 0
        ? parsed.placeId ? "Viestin käyttöpaikan tunnus ei kuulu lähettäjälle." : "Lähettäjällä ei ole voimassa olevaa sopimusta, jolla on mittari."
        : "Lähettäjällä on useita mittareita; viestistä ei selviä, mitä lukema koskee.";
      const reply = candidates.length > 1 ? "Sinulla on useita kiinteistöjä. Lähetä käyttöpaikan numero ja lukema, esimerkiksi 40960 1234." : askAgain;
      return unmatched(org.id, reason, customers.length === 1 ? customers[0].id : null, reply);
    }

    const target = candidates[0];
    const readOn = dateOf(receivedAt);
    const clash = await tx.query("select 1 from ml_readings where meter_id = $1 and read_on = $2 and status <> 'rejected'", [target.meter_id, readOn]);
    if (clash.length) return unmatched(org.id, "Mittarille on jo lukema tälle päivälle.", target.customer_id, "Lukema on jo kirjattu tälle päivälle. Kiitos.");
    const [round] = await tx.query<{ id: string }>(
      "select id from ml_reading_rounds where organization_id = $1 and status = 'open' order by target_date desc limit 1",
      [org.id],
    );
    const res = await recordReading(tx, {
      organizationId: org.id, meterId: target.meter_id, readOn, reading: parsed.reading, source: "sms", userId: null, roundId: round?.id ?? null,
    });
    const status = res.issues.length ? "needs_review" : "recorded";
    const reply = `Kiitos! Lukema ${fmt(parsed.reading)} m3 vastaanotettu (${target.street_address}).`;
    const id = await save({ orgId: org.id, status, reason: res.issues.length ? `Poikkeava lukema: ${res.issues.map((i) => ISSUE_LABEL[i].toLowerCase()).join(", ")}` : null,
      customerId: target.customer_id, propertyId: target.property_id, readingId: res.id, reply });
    await tx.query("insert into ml_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'reading.sms', 'ml_readings', $2, $3)", [
      org.id, res.id, JSON.stringify({ sms: id, status }),
    ]);
    return { id, status, reply };
  });
}
