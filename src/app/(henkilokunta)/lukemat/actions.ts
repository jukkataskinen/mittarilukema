"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireStaff } from "@/lib/auth/current-user";
import { fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { parseReading } from "@/lib/readings/checks";
import { recordReading, reviewReading } from "@/lib/readings/record";
import { audit } from "@/lib/audit";
import { isoDateHelsinki } from "@/lib/format";

/** Paluuosoite vain sovelluksen sisäinen polku. */
const safeBack = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
};

export async function reviewReadingAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const backTo = safeBack(formData.get("backTo"), "/lukemat");
  const input = z
    .object({ readingId: z.string().uuid(), decision: z.enum(["accepted", "rejected"]) })
    .parse({ readingId: formData.get("readingId"), decision: formData.get("decision") });
  await ctx.run((tx) => reviewReading(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, ...input }));
  revalidatePath(backTo);
  redirect(backTo);
}

const readingSchema = z.object({
  meterId: z.string().uuid(),
  readOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna lukemapäivä."),
  reading: z.string().min(1, "Anna lukema."),
  roundId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()).optional(),
  note: z.preprocess((v) => (v === "" ? null : v), z.string().max(500).nullable()).optional(),
});

export async function addReadingAction(formData: FormData) {
  const ctx = await requireStaff();
  const backTo = safeBack(formData.get("backTo"), "/lukemat");
  const input = parseForm(readingSchema, formData, backTo);
  const value = parseReading(input.reading);
  if (value === null) fail(backTo, "Lukema on luku, jossa on enintään kolme desimaalia.");
  if (input.readOn > isoDateHelsinki()) fail(backTo, "Lukemapäivä ei voi olla tulevaisuudessa.");

  const source = ctx.can("reader") ? "reader" : "staff";
  let issues: string[] = [];
  try {
    issues = (
      await ctx.run((tx) =>
        recordReading(tx, {
          organizationId: ctx.org.organizationId,
          meterId: input.meterId,
          readOn: input.readOn,
          reading: value,
          source,
          userId: ctx.user.id,
          roundId: input.roundId ?? null,
          note: input.note ?? null,
        }),
      )
    ).issues;
  } catch (err) {
    if (isUniqueViolation(err)) fail(backTo, "Mittarilla on jo lukema tälle päivälle. Toimisto voi korjata sen.");
    throw err;
  }
  revalidatePath(backTo);
  const sep = backTo.includes("?") ? "&" : "?";
  redirect(`${backTo}${sep}${issues.length ? "ilmoitus=tarkistettava" : "ilmoitus=tallennettu"}`);
}

const roundSchema = z.object({
  name: z.string().min(1, "Anna kierrokselle nimi.").max(100),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna lukemapäivä."),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Anna määräpäivä."),
});

export async function createRoundAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(roundSchema, formData, "/lukemat");
  if (input.dueDate < input.targetDate) fail("/lukemat", "Määräpäivä ei voi olla ennen lukemapäivää.");
  try {
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        "insert into ml_reading_rounds (organization_id, name, target_date, due_date, created_by) values ($1, $2, $3, $4, $5) returning id",
        [ctx.org.organizationId, input.name, input.targetDate, input.dueDate, ctx.user.id],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "round.create", entity: "ml_reading_rounds", entityId: row.id });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail("/lukemat", "Samanniminen kierros on jo olemassa.");
    throw err;
  }
  revalidatePath("/lukemat");
  redirect("/lukemat");
}

export async function closeRoundAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = z.string().uuid().parse(formData.get("roundId"));
  await ctx.run(async (tx) => {
    await tx.query("update ml_reading_rounds set status = 'closed' where id = $1 and organization_id = $2", [id, ctx.org.organizationId]);
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "round.close", entity: "ml_reading_rounds", entityId: id });
  });
  revalidatePath("/lukemat");
  redirect("/lukemat");
}
