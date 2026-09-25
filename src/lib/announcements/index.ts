import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { EmailError, type EmailSender } from "@/lib/email";
import { LetterServiceError, type LetterJob, type LetterSender } from "@/lib/letters";
import { buildLettersPdf } from "./letter";
import { getAttachment } from "./attachment";

/**
 * Tiedotteet asiakkaille. Toimitus ensisijaisesti sähköpostilla; ilman
 * sähköpostia (tai kun tiedote halutaan kaikille kirjeenä) tiedote
 * tulostetaan ikkunakirjeeksi (letter.ts). Toimitustapa päätetään säännöllä,
 * joka näytetään ennen lähetystä, ja vastaanottajat lukitaan lähetyksen alkaessa.
 */

export type Audience = "payers" | "contracts";
export type Delivery = "email_first" | "letter_all";
export type Channel = "email" | "letter" | "none";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  payers: "Laskun maksajat (voimassa olevat laskutettavat sopimukset)",
  contracts: "Kaikki voimassa olevien sopimusten osapuolet (myös omistajat, jotka eivät maksa)",
};
export const DELIVERY_LABEL: Record<Delivery, string> = {
  email_first: "Sähköposti, kirje jos sähköpostia ei ole",
  letter_all: "Kaikille kirje (sähköposti vain, jos postiosoite puuttuu)",
};
export const ANNOUNCEMENT_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  draft: { label: "Luonnos", tone: "neutral" },
  sending: { label: "Lähetys kesken", tone: "warn" },
  sent: { label: "Lähetetty", tone: "ok" },
};
export const RECIPIENT_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "ok" | "alert" }> = {
  pending: { label: "Odottaa", tone: "neutral" },
  sending: { label: "Kesken, tarkista", tone: "warn" },
  sent: { label: "Lähetetty", tone: "ok" },
  failed: { label: "Epäonnistui", tone: "alert" },
  printed: { label: "Postitettu", tone: "ok" },
  unreachable: { label: "Ei tavoitettavissa", tone: "alert" },
};
export const CHANNEL_LABEL: Record<Channel, string> = { email: "Sähköposti", letter: "Kirje", none: "Ei tavoitettavissa" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RecipientCustomer {
  customer_id: string;
  name: string;
  email: string | null;
  billing_street: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
}

/** Postiosoitteen rivit ikkunakirjeeseen; tyhjä, jos osoite on puutteellinen. */
export function addressLines(c: RecipientCustomer): string[] {
  if (!c.billing_street?.trim() || !/^\d{5}$/.test(c.billing_postal_code ?? "") || !c.billing_city?.trim()) return [];
  return [c.name.trim(), c.billing_street.trim(), `${c.billing_postal_code} ${c.billing_city.trim().toUpperCase()}`];
}

export function decideChannel(c: RecipientCustomer, delivery: Delivery): Channel {
  const email = !!c.email && EMAIL.test(c.email);
  const letter = addressLines(c).length > 0;
  if (delivery === "letter_all") return letter ? "letter" : email ? "email" : "none";
  return email ? "email" : letter ? "letter" : "none";
}

/** Vastaanottajat tiedotteen rajauksella tänä päivänä voimassa olevista sopimuksista. */
export async function findRecipients(tx: Sql, orgId: string, a: { audience: Audience; area_id: string | null; delivery: Delivery }, today: string) {
  const rows = await tx.query<RecipientCustomer>(
    `select distinct c.id as customer_id, c.name, c.email, c.billing_street, c.billing_postal_code, c.billing_city
       from ml_contracts k
       join ml_customers c on c.id = k.customer_id
       join ml_properties p on p.id = k.property_id
      where k.organization_id = $1 and k.starts_on <= $2 and (k.ends_on is null or k.ends_on >= $2)
        and ($3 = 'contracts' or k.billed) and ($4::uuid is null or p.area_id = $4)
      order by c.name`,
    [orgId, today, a.audience, a.area_id],
  );
  return rows.map((r) => ({ ...r, channel: decideChannel(r, a.delivery), address_lines: addressLines(r) }));
}

export class AnnouncementError extends Error {}

/** Lukitsee vastaanottajat ja siirtää tiedotteen lähetystilaan. */
export async function lockAnnouncement(tx: Sql, input: { organizationId: string; userId: string; announcementId: string; today: string }) {
  const [a] = await tx.query<{ status: string; audience: Audience; area_id: string | null; delivery: Delivery }>(
    "select status, audience, area_id, delivery from ml_announcements where id = $1 and organization_id = $2 for update",
    [input.announcementId, input.organizationId],
  );
  if (!a) throw new AnnouncementError("Tiedotetta ei löytynyt.");
  if (a.status !== "draft") throw new AnnouncementError("Tiedotteen vastaanottajat on jo lukittu.");
  const recipients = await findRecipients(tx, input.organizationId, a, input.today);
  if (!recipients.length) throw new AnnouncementError("Rajauksella ei löytynyt vastaanottajia.");
  const [content] = await tx.query<{ body: string; has_pdf: boolean }>(
    "select a.body, exists (select 1 from ml_announcement_attachments t where t.announcement_id = a.id) as has_pdf from ml_announcements a where a.id = $1",
    [input.announcementId],
  );
  if (!content.body.trim() && !content.has_pdf) throw new AnnouncementError("Kirjoita tiedotteen teksti tai liitä PDF ennen lähetystä.");
  await tx.query(
    `insert into ml_announcement_recipients (organization_id, announcement_id, customer_id, channel, name, email, address_lines, status)
     select $1, $2, x.customer_id, x.channel, x.name, x.email, array(select json_array_elements_text(x.address_lines)),
            case when x.channel = 'none' then 'unreachable' else 'pending' end
       from json_to_recordset($3::json) as x(customer_id uuid, channel text, name text, email text, address_lines json)`,
    [
      input.organizationId, input.announcementId,
      JSON.stringify(recipients.map((r) => ({ customer_id: r.customer_id, channel: r.channel, name: r.name, email: r.channel === "email" ? r.email : null, address_lines: r.address_lines }))),
    ],
  );
  await tx.query("update ml_announcements set status = 'sending', locked_at = now(), locked_by = $2, updated_at = now() where id = $1", [input.announcementId, input.userId]);
  const counts = { email: 0, letter: 0, none: 0 };
  for (const r of recipients) counts[r.channel]++;
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "announcement.lock", entity: "ml_announcements", entityId: input.announcementId, details: counts });
  return counts;
}

export interface OrgContact {
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  postal_street: string | null;
  postal_code: string | null;
  postal_city: string | null;
}

/** Allekirjoitus ja yhteystiedot tiedotteen loppuun. */
export function signature(org: OrgContact): string[] {
  return [
    org.name,
    [org.postal_street, [org.postal_code, org.postal_city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [org.contact_phone, org.contact_email].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sähköposti: kappaleet tyhjän rivin kohdalta, ei ulkoisia kuvia eikä seurantaa. */
export function composeEmail(a: { title: string; body: string }, org: OrgContact, attachmentName?: string | null) {
  const sig = signature(org);
  // PDF-tiedotteessa teksti voi puuttua: kerrotaan, että tiedote on liitteenä.
  const body = a.body.trim() || (attachmentName ? "Tiedote on tämän viestin liitteenä (PDF)." : "");
  const note = attachmentName && a.body.trim() ? `\n\nLiite: ${attachmentName}` : "";
  const text = `${body}${note}\n\n${sig.join("\n")}\n`;
  const paragraphs = `${body}${note}`.split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  const html = `<!doctype html><html lang="fi"><body style="margin:0;padding:24px;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 18px">${escapeHtml(a.title)}</h1>
${paragraphs.join("\n")}
<p style="margin:24px 0 0;color:#4b5563;font-size:14px">${sig.map(escapeHtml).join("<br>")}</p>
</div></body></html>`;
  return { subject: a.title, text, html };
}

/**
 * Lähettää seuraavat `batch` sähköpostia. Vastaanottajat varataan ensin
 * tilaan sending, jotta rinnakkainen painallus ei lähetä samaa viestiä
 * kahdesti. Kesken jäänyt (sending) ei lähde uudelleen automaattisesti.
 */
export async function sendEmailBatch(
  run: <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>,
  sender: EmailSender,
  input: { organizationId: string; userId: string; announcementId: string; batch?: number },
) {
  const claimed = await run(async (tx) => {
    const [a] = await tx.query<{ status: string; title: string; body: string } & OrgContact>(
      `select a.status, a.title, a.body, o.name, o.contact_email, o.contact_phone, o.postal_street, o.postal_code, o.postal_city
         from ml_announcements a join ml_organizations o on o.id = a.organization_id where a.id = $1 and a.organization_id = $2`,
      [input.announcementId, input.organizationId],
    );
    if (!a) throw new AnnouncementError("Tiedotetta ei löytynyt.");
    if (a.status === "draft") throw new AnnouncementError("Lukitse vastaanottajat ennen lähetystä.");
    const rows = await tx.query<{ id: string; email: string }>(
      `update ml_announcement_recipients set status = 'sending'
        where id in (select id from ml_announcement_recipients
                      where announcement_id = $1 and organization_id = $2 and channel = 'email' and status in ('pending', 'failed')
                      order by name limit $3 for update skip locked)
        returning id, email`,
      [input.announcementId, input.organizationId, input.batch ?? 40],
    );
    return { a, rows, attachment: rows.length ? await getAttachment(tx, input.organizationId, input.announcementId) : null };
  });

  const message = composeEmail(claimed.a, claimed.a, claimed.attachment?.filename);
  const attachments = claimed.attachment ? [{ filename: claimed.attachment.filename, content: claimed.attachment.data }] : undefined;
  const results: { id: string; ok: boolean; error: string | null }[] = [];
  for (const r of claimed.rows) {
    try {
      await sender.send({ ...message, to: r.email, fromName: claimed.a.name, replyTo: claimed.a.contact_email, attachments });
      results.push({ id: r.id, ok: true, error: null });
    } catch (err) {
      results.push({ id: r.id, ok: false, error: err instanceof EmailError ? err.message : "Lähetys epäonnistui." });
    }
    // Palvelun raja noin 2 viestiä sekunnissa.
    if (sender.mode !== "mock") await new Promise((res) => setTimeout(res, 550));
  }

  return run(async (tx) => {
    for (const r of results) {
      await tx.query("update ml_announcement_recipients set status = $2, message = $3, sent_at = case when $2 = 'sent' then now() else sent_at end where id = $1", [
        r.id, r.ok ? "sent" : "failed", r.error,
      ]);
    }
    const [left] = await tx.query<{ n: number }>(
      "select count(*)::int as n from ml_announcement_recipients where announcement_id = $1 and channel = 'email' and status = 'pending'",
      [input.announcementId],
    );
    await markSentIfDone(tx, input.announcementId);
    const summary = { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, remaining: left.n, mode: sender.mode };
    await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "announcement.email", entity: "ml_announcements", entityId: input.announcementId, details: summary });
    return summary;
  });
}

/** Kirjeet merkitään postitetuiksi, kun ne on tulostettu ja laitettu kuoriin. */
export async function markLettersPrinted(tx: Sql, input: { organizationId: string; userId: string; announcementId: string }) {
  const rows = await tx.query(
    `update ml_announcement_recipients set status = 'printed', sent_at = now()
      where announcement_id = $1 and organization_id = $2 and channel = 'letter' and status = 'pending' returning id`,
    [input.announcementId, input.organizationId],
  );
  await markSentIfDone(tx, input.announcementId);
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "announcement.letters", entity: "ml_announcements", entityId: input.announcementId, details: { letters: rows.length } });
  return rows.length;
}

async function markSentIfDone(tx: Sql, announcementId: string) {
  await tx.query(
    `update ml_announcements set status = 'sent', updated_at = now()
      where id = $1 and status = 'sending'
        and not exists (select 1 from ml_announcement_recipients where announcement_id = $1 and status in ('pending', 'sending', 'failed'))`,
    [announcementId],
  );
}

type Runner = <T>(fn: (tx: Sql) => Promise<T>) => Promise<T>;

/**
 * Kirjeet postituspalveluun vahvistamattomana työnä. Vastaanottajat varataan
 * tilaan sending, jottei samaa kirjettä ladata kahdesti. Jos lataus
 * epäonnistuu, varaus puretaan.
 */
export async function uploadLetters(
  run: Runner,
  sender: LetterSender,
  input: { organizationId: string; userId: string; announcementId: string; postClass: 1 | 2; date: string },
) {
  const claimed = await run(async (tx) => {
    const [a] = await tx.query<{ status: string; title: string; body: string; letter_job_id: string | null; letter_job_status: string | null } & OrgContact>(
      `select a.status, a.title, a.body, a.letter_job_id, a.letter_job_status, o.name, o.contact_email, o.contact_phone, o.postal_street, o.postal_code, o.postal_city
         from ml_announcements a join ml_organizations o on o.id = a.organization_id where a.id = $1 and a.organization_id = $2 for update of a`,
      [input.announcementId, input.organizationId],
    );
    if (!a) throw new AnnouncementError("Tiedotetta ei löytynyt.");
    if (a.status === "draft") throw new AnnouncementError("Lukitse vastaanottajat ennen kirjeiden lähetystä.");
    if (a.letter_job_id && a.letter_job_status === "NE") throw new AnnouncementError("Kirjeet odottavat jo vahvistusta. Vahvista tai peru edellinen työ.");
    if (!a.postal_street) throw new AnnouncementError("Organisaation postiosoite puuttuu. Lisää se Asetuksissa, se tulee kirjeen lähettäjäksi.");
    const rows = await tx.query<{ id: string; name: string; address_lines: string[] }>(
      `update ml_announcement_recipients set status = 'sending'
        where announcement_id = $1 and organization_id = $2 and channel = 'letter' and status = 'pending'
        returning id, name, address_lines`,
      [input.announcementId, input.organizationId],
    );
    if (!rows.length) throw new AnnouncementError("Ei lähetettäviä kirjeitä.");
    return { a, rows: rows.sort((x, y) => x.name.localeCompare(y.name, "fi")), attachment: await getAttachment(tx, input.organizationId, input.announcementId) };
  });

  let job: LetterJob;
  try {
    const { pdf, pagesPerLetter } = await buildLettersPdf(claimed.a, claimed.a, claimed.rows, { date: input.date, attachment: claimed.attachment?.data });
    // Postita tulostaa enintään 12 sivua kirjettä kohden.
    if (pagesPerLetter > 12) throw new AnnouncementError(`Kirjeessä on ${pagesPerLetter} sivua, Postitan enimmäismäärä on 12. Lyhennä tekstiä tai PDF:ää.`);
    job = await sender.upload({ jobName: `${claimed.a.name}: ${claimed.a.title}`.slice(0, 200), pdf, pagesPerLetter, letters: claimed.rows.length, postClass: input.postClass });
  } catch (err) {
    await run((tx) => tx.query("update ml_announcement_recipients set status = 'pending' where id = any($1::uuid[])", [claimed.rows.map((r) => r.id)]));
    if (err instanceof LetterServiceError) throw new AnnouncementError(err.message);
    throw err;
  }

  return run(async (tx) => {
    await tx.query(
      `update ml_announcements set letter_job_id = $2, letter_job_status = $3, letter_job_price = $4, letter_post_class = $5, letter_job_mode = $6, updated_at = now()
        where id = $1`,
      [input.announcementId, job.id, job.status, job.price, input.postClass, sender.mode],
    );
    await audit(tx, {
      organizationId: input.organizationId, userId: input.userId, action: "announcement.letters_upload", entity: "ml_announcements", entityId: input.announcementId,
      details: { letters: claimed.rows.length, postClass: input.postClass, mode: sender.mode, status: job.status },
    });
    return { letters: claimed.rows.length, job };
  });
}

/** Vahvistaa kirjetyön postitettavaksi; vastaanottajat merkitään postitetuiksi. */
export async function confirmLetters(run: Runner, sender: LetterSender, input: { organizationId: string; userId: string; announcementId: string }) {
  const jobId = await pendingJob(run, input);
  let job: LetterJob;
  try {
    job = await sender.confirm(jobId);
  } catch (err) {
    if (err instanceof LetterServiceError) throw new AnnouncementError(err.message);
    throw err;
  }
  return run(async (tx) => {
    const rows = await tx.query(
      `update ml_announcement_recipients set status = 'printed', sent_at = now()
        where announcement_id = $1 and organization_id = $2 and channel = 'letter' and status = 'sending' returning id`,
      [input.announcementId, input.organizationId],
    );
    await tx.query("update ml_announcements set letter_job_status = $2, letter_job_price = coalesce($3, letter_job_price), updated_at = now() where id = $1", [
      input.announcementId, job.status || "CO", job.price,
    ]);
    await markSentIfDone(tx, input.announcementId);
    await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "announcement.letters_confirm", entity: "ml_announcements", entityId: input.announcementId, details: { letters: rows.length } });
    return rows.length;
  });
}

/** Peruu vahvistamattoman kirjetyön; kirjeet palaavat lähettämättömiksi. */
export async function cancelLetters(run: Runner, sender: LetterSender, input: { organizationId: string; userId: string; announcementId: string }) {
  const jobId = await pendingJob(run, input);
  try {
    await sender.cancel(jobId);
  } catch (err) {
    if (err instanceof LetterServiceError) throw new AnnouncementError(err.message);
    throw err;
  }
  await run(async (tx) => {
    await tx.query("update ml_announcement_recipients set status = 'pending' where announcement_id = $1 and organization_id = $2 and channel = 'letter' and status = 'sending'", [
      input.announcementId, input.organizationId,
    ]);
    await tx.query("update ml_announcements set letter_job_status = 'CA', updated_at = now() where id = $1", [input.announcementId]);
    await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "announcement.letters_cancel", entity: "ml_announcements", entityId: input.announcementId });
  });
}

async function pendingJob(run: Runner, input: { organizationId: string; announcementId: string }) {
  const [a] = await run((tx) =>
    tx.query<{ letter_job_id: string | null; letter_job_status: string | null }>(
      "select letter_job_id, letter_job_status from ml_announcements where id = $1 and organization_id = $2",
      [input.announcementId, input.organizationId],
    ),
  );
  if (!a?.letter_job_id || a.letter_job_status !== "NE") throw new AnnouncementError("Vahvistamatonta kirjetyötä ei ole.");
  return a.letter_job_id;
}
