"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";
import { emailSender, EmailError } from "@/lib/email";
import { AnnouncementError, composeEmail, lockAnnouncement, markLettersPrinted, sendEmailBatch, type OrgContact } from "@/lib/announcements";

const schema = z.object({
  title: z.string().trim().min(1, "Anna tiedotteelle otsikko.").max(200),
  body: z.string().trim().min(1, "Kirjoita tiedotteen teksti.").max(20000),
  audience: z.enum(["payers", "contracts"]),
  areaId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  delivery: z.enum(["email_first", "letter_all"]),
});

const idOf = (formData: FormData) => z.string().uuid().parse(formData.get("announcementId"));

export async function createAnnouncementAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(schema, formData, "/tiedotteet/uusi");
  const id = await ctx.run(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      "insert into ml_announcements (organization_id, title, body, audience, area_id, delivery, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [ctx.org.organizationId, input.title, input.body, input.audience, input.areaId, input.delivery, ctx.user.id],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "announcement.create", entity: "ml_announcements", entityId: row.id });
    return row.id;
  });
  revalidatePath("/tiedotteet");
  redirect(`/tiedotteet/${id}`);
}

export async function updateAnnouncementAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const input = parseForm(schema, formData, `/tiedotteet/${id}/muokkaa`);
  const ok = await ctx.run(async (tx) => {
    const rows = await tx.query(
      `update ml_announcements set title = $3, body = $4, audience = $5, area_id = $6, delivery = $7, updated_at = now()
        where id = $1 and organization_id = $2 and status = 'draft' returning id`,
      [id, ctx.org.organizationId, input.title, input.body, input.audience, input.areaId, input.delivery],
    );
    if (rows.length) await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "announcement.update", entity: "ml_announcements", entityId: id });
    return rows.length > 0;
  });
  if (!ok) fail(`/tiedotteet/${id}`, "Lähetettyä tiedotetta ei voi muuttaa.");
  revalidatePath(`/tiedotteet/${id}`);
  redirect(`/tiedotteet/${id}`);
}

export async function deleteAnnouncementAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const ok = await ctx.run(async (tx) => {
    const rows = await tx.query("delete from ml_announcements where id = $1 and organization_id = $2 and status = 'draft' returning id", [id, ctx.org.organizationId]);
    if (rows.length) await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "announcement.delete", entity: "ml_announcements", entityId: id });
    return rows.length > 0;
  });
  if (!ok) fail(`/tiedotteet/${id}`, "Vain luonnoksen voi poistaa.");
  revalidatePath("/tiedotteet");
  redirect("/tiedotteet");
}

export async function lockAnnouncementAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  try {
    await ctx.run((tx) => lockAnnouncement(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, announcementId: id, today: isoDateHelsinki() }));
  } catch (err) {
    if (err instanceof AnnouncementError) fail(`/tiedotteet/${id}`, err.message);
    throw err;
  }
  revalidatePath(`/tiedotteet/${id}`);
  redirect(`/tiedotteet/${id}`);
}

export async function sendEmailsAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const back = `/tiedotteet/${id}`;
  let sender;
  try {
    sender = emailSender();
  } catch (err) {
    fail(back, err instanceof EmailError ? err.message : "Sähköpostipalvelua ei ole määritetty.");
  }
  let s;
  try {
    s = await sendEmailBatch(ctx.run.bind(ctx), sender!, { organizationId: ctx.org.organizationId, userId: ctx.user.id, announcementId: id });
  } catch (err) {
    if (err instanceof AnnouncementError) fail(back, err.message);
    throw err;
  }
  revalidatePath(back);
  redirect(`${back}?lahetetty=${s.sent}&epaonnistui=${s.failed}&jaljella=${s.remaining}`);
}

/** Koeviesti kirjautuneen käyttäjän omaan osoitteeseen ennen varsinaista lähetystä. */
export async function sendTestEmailAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const back = `/tiedotteet/${id}`;
  const data = await ctx.run(async (tx) => {
    const [a] = await tx.query<{ title: string; body: string } & OrgContact>(
      `select a.title, a.body, o.name, o.contact_email, o.contact_phone, o.postal_street, o.postal_code, o.postal_city
         from ml_announcements a join ml_organizations o on o.id = a.organization_id where a.id = $1 and a.organization_id = $2`,
      [id, ctx.org.organizationId],
    );
    return a ?? null;
  });
  if (!data) fail("/tiedotteet", "Tiedotetta ei löytynyt.");
  try {
    const m = composeEmail(data!, data!);
    await emailSender().send({ ...m, subject: `Koe: ${m.subject}`, to: ctx.user.email, fromName: data!.name, replyTo: data!.contact_email });
  } catch (err) {
    fail(back, err instanceof EmailError ? err.message : "Koeviestin lähetys epäonnistui.");
  }
  redirect(`${back}?koeviesti=1`);
}

export async function markLettersAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const n = await ctx.run((tx) => markLettersPrinted(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, announcementId: id }));
  revalidatePath(`/tiedotteet/${id}`);
  redirect(`/tiedotteet/${id}?postitettu=${n}`);
}
