"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import type { Sql } from "@/lib/db/types";
import { emptyToNull, fail, isExclusionViolation, parseForm } from "@/lib/forms";
import { parseReading } from "@/lib/readings/checks";
import { normalizePhone } from "@/lib/validation/phone";
import { audit } from "@/lib/audit";
import { ChangeError, changeOwner, changeTenant, confirmLoanTransfer } from "@/lib/registry/changes";
import { closeRequest } from "@/lib/change-requests";
import { MeterSwapError, swapMeter } from "@/lib/meters/swap";
import { isoDateHelsinki } from "@/lib/format";

const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const optionalText = (max = 200) => z.preprocess(emptyToNull, z.string().max(max).nullable());

// Uusi osapuoli valitaan rekisteristä tai perustetaan samalla lomakkeella,
// jottei vaihdosta tarvitse keskeyttää asiakkaan lisäämiseksi.
const partySchema = z.object({
  customerId: z.string().min(1, "Valitse asiakas tai perusta uusi."),
  newKind: z.enum(["person", "company"]).default("person"),
  newName: optionalText(200),
  newEmail: z.preprocess(emptyToNull, z.string().email("Tarkista sähköpostiosoite.").max(200).nullable()),
  newPhone: optionalText(40),
  newStreet: optionalText(200),
  newPostalCode: z.preprocess(emptyToNull, z.string().regex(/^\d{5}$/, "Postinumero on viisi numeroa.").nullable()),
  newCity: optionalText(100),
});

async function resolveParty(tx: Sql, orgId: string, userId: string, p: z.infer<typeof partySchema>, back: string): Promise<string> {
  if (p.customerId !== "new") {
    if (!z.string().uuid().safeParse(p.customerId).success) fail(back, "Valitse asiakas tai perusta uusi.");
    return p.customerId;
  }
  if (!p.newName) fail(back, "Anna uuden asiakkaan nimi.");
  let phone: string | null = null;
  if (p.newPhone) {
    phone = normalizePhone(p.newPhone);
    if (!phone) fail(back, "Tarkista puhelinnumero, esimerkiksi 040 123 4567.");
  }
  const [row] = await tx.query<{ id: string }>(
    `insert into ml_customers (organization_id, kind, name, email, phone, billing_street, billing_postal_code, billing_city)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [orgId, p.newKind, p.newName, p.newEmail, phone, p.newStreet, p.newPostalCode, p.newCity],
  );
  await audit(tx, { organizationId: orgId, userId, action: "customer.create", entity: "ml_customers", entityId: row.id });
  return row.id;
}

/** Lukemat kentistä reading_<mittarin tunnus>. Tyhjä kenttä jää puuttuvaksi, ja kirjasto ilmoittaa siitä. */
function readingsFrom(formData: FormData, back: string) {
  const out: { meterId: string; reading: number }[] = [];
  for (const [key, value] of formData.entries()) {
    const m = /^reading_([0-9a-f-]{36})$/.exec(key);
    if (!m || typeof value !== "string" || value.trim() === "") continue;
    const reading = parseReading(value);
    if (reading === null) fail(back, "Tarkista lukema: anna pelkkä luku, esimerkiksi 1234,5.");
    out.push({ meterId: m[1], reading });
  }
  return out;
}

// Virheen jälkeen lomake palaa samaan ilmoitukseen, jotta esitäyttö säilyy.
const requestQuery = (formData: FormData) => {
  const id = z.string().uuid().safeParse(formData.get("requestId"));
  return id.success ? `?ilmoitus=${id.data}` : "";
};

/** Muutosilmoituksesta aloitettu vaihdos merkitsee ilmoituksen käsitellyksi samassa transaktiossa. */
async function closeFromRequest(tx: Sql, orgId: string, userId: string, formData: FormData, eventId: string) {
  const requestId = z.string().uuid().safeParse(formData.get("requestId"));
  if (!requestId.success) return;
  await closeRequest(tx, { organizationId: orgId, userId, id: requestId.data, status: "done", eventId, note: "Kirjattu vaihdostoiminnolla." });
}

const ownerSchema = partySchema.extend({
  propertyId: z.string().uuid(),
  date: date("Anna vaihtopäivä."),
  loanDecision: z.preprocess(emptyToNull, z.enum(["stays_with_seller", "transfers"]).nullable()),
  endTenant: z.preprocess((v) => v === "on", z.boolean()),
  notes: optionalText(2000),
});

export async function changeOwnerAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const propertyId = String(formData.get("propertyId") ?? "");
  const back = `/kiinteistot/${propertyId}/omistajanvaihdos${requestQuery(formData)}`;
  const input = parseForm(ownerSchema, formData, back);
  const readings = readingsFrom(formData, back);
  let result: { needsReview: number } = { needsReview: 0 };
  try {
    result = await ctx.run(async (tx) => {
      const newCustomerId = await resolveParty(tx, ctx.org.organizationId, ctx.user.id, input, back);
      const res = await changeOwner(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, propertyId: input.propertyId, date: input.date, newCustomerId, readings,
        loanDecision: input.loanDecision, endTenant: input.endTenant, notes: input.notes,
      });
      await closeFromRequest(tx, ctx.org.organizationId, ctx.user.id, formData, res.eventId);
      return res;
    });
  } catch (err) {
    if (err instanceof ChangeError) fail(back, err.message);
    if (isExclusionViolation(err)) fail(back, "Sopimukset menisivät päällekkäin. Tarkista vaihtopäivä ja käyttöpaikan sopimukset.");
    throw err;
  }
  revalidatePath(`/kiinteistot/${input.propertyId}`);
  redirect(`/kiinteistot/${input.propertyId}?ilmoitus=${result.needsReview ? "vaihdos-tarkistettava" : "omistajanvaihdos"}`);
}

const tenantSchema = partySchema.extend({
  propertyId: z.string().uuid(),
  date: date("Anna vaihtopäivä."),
  endCurrent: z.preprocess((v) => v === "on", z.boolean()),
  customerId: z.string().default(""),
  notes: optionalText(2000),
});

export async function changeTenantAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const propertyId = String(formData.get("propertyId") ?? "");
  const back = `/kiinteistot/${propertyId}/vuokralainen${requestQuery(formData)}`;
  const input = parseForm(tenantSchema, formData, back);
  const components = z.array(z.enum(["usage", "basic_fee", "other_fee"])).safeParse(formData.getAll("tenantComponents"));
  const readings = readingsFrom(formData, back);
  let result: { needsReview: number } = { needsReview: 0 };
  try {
    result = await ctx.run(async (tx) => {
      // Tyhjä valinta = ei uutta vuokralaista (vain poismuutto).
      const newCustomerId = input.customerId ? await resolveParty(tx, ctx.org.organizationId, ctx.user.id, input, back) : null;
      const res = await changeTenant(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, propertyId: input.propertyId, date: input.date, endCurrent: input.endCurrent,
        newCustomerId, components: components.success ? components.data : [], readings, notes: input.notes,
      });
      await closeFromRequest(tx, ctx.org.organizationId, ctx.user.id, formData, res.eventId);
      return res;
    });
  } catch (err) {
    if (err instanceof ChangeError) fail(back, err.message);
    if (isExclusionViolation(err)) fail(back, "Sopimukset menisivät päällekkäin. Tarkista vaihtopäivä ja käyttöpaikan sopimukset.");
    throw err;
  }
  revalidatePath(`/kiinteistot/${input.propertyId}`);
  redirect(`/kiinteistot/${input.propertyId}?ilmoitus=${result.needsReview ? "vaihdos-tarkistettava" : "vuokralainen"}`);
}

export async function confirmLoanTransferAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const parsed = z.object({ loanId: z.string().uuid(), propertyId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/kiinteistot", "Tarkista lomakkeen tiedot.");
  const back = `/kiinteistot/${parsed.data.propertyId}`;
  const ok = await ctx.run((tx) => confirmLoanTransfer(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, loanId: parsed.data.loanId }));
  if (!ok) fail(back, "Lainalle ei ole kirjattu erillistä velallista.");
  revalidatePath(back);
  redirect(`${back}?ilmoitus=laina-siirretty`);
}

const swapSchema = z.object({
  propertyId: z.string().uuid(),
  oldMeterId: z.string().uuid({ message: "Valitse vaihdettava mittari." }),
  date: date("Anna vaihtopäivä."),
  finalReading: z.string().min(1, "Anna vanhan mittarin loppulukema."),
  newMeterNumber: z.string().trim().min(1, "Anna uuden mittarin numero.").max(60),
  startReading: z.string().min(1, "Anna uuden mittarin aloituslukema."),
  readMethod: z.enum(["remote", "mechanical"]),
  notes: optionalText(2000),
});

export async function swapMeterAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const propertyId = String(formData.get("propertyId") ?? "");
  const back = `/kiinteistot/${propertyId}/mittarinvaihto`;
  const input = parseForm(swapSchema, formData, back);
  const finalReading = parseReading(input.finalReading);
  const startReading = parseReading(input.startReading);
  if (finalReading === null || startReading === null) fail(`${back}?mittari=${input.oldMeterId}`, "Tarkista lukemat: anna pelkkä luku, esimerkiksi 1234,5.");
  try {
    await ctx.run((tx) =>
      swapMeter(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, oldMeterId: input.oldMeterId, today: isoDateHelsinki(), date: input.date,
        finalReading, startReading, newMeterNumber: input.newMeterNumber, readMethod: input.readMethod, source: "staff", notes: input.notes,
      }),
    );
  } catch (err) {
    if (err instanceof MeterSwapError) fail(`${back}?mittari=${input.oldMeterId}`, err.message);
    throw err;
  }
  revalidatePath(`/kiinteistot/${input.propertyId}`);
  redirect(`/kiinteistot/${input.propertyId}?ilmoitus=mittari-vaihdettu`);
}
