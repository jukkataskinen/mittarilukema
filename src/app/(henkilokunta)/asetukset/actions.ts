"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { addMember, changeMemberRole, MemberError, removeMember } from "@/lib/members";

const BACK = "/asetukset";

export async function updateBillingAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const months = formData
    .getAll("billingMonths")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  const input = z
    .object({
      billingMethod: z.enum(["actual", "estimate"]),
      settlementMonth: z.preprocess((v) => (v === "" || v === null ? null : Number(v)), z.number().int().min(1).max(12).nullable()),
    })
    .safeParse({ billingMethod: formData.get("billingMethod"), settlementMonth: formData.get("settlementMonth") });
  if (!input.success) fail(BACK, "Tarkista laskutuksen asetukset.");
  if (input.data.billingMethod === "actual" && months.length === 0) fail(BACK, "Valitse vähintään yksi laskutuskuukausi.");
  if (input.data.billingMethod === "estimate" && !input.data.settlementMonth) fail(BACK, "Valitse tasauslaskun kuukausi.");

  await ctx.run(async (tx) => {
    await tx.query("update ml_organizations set billing_method = $2, billing_months = $3, settlement_month = $4 where id = $1", [
      ctx.org.organizationId,
      input.data.billingMethod,
      input.data.billingMethod === "actual" ? months : Array.from({ length: 12 }, (_, i) => i + 1),
      input.data.billingMethod === "estimate" ? input.data.settlementMonth : null,
    ]);
    await audit(tx, {
      organizationId: ctx.org.organizationId,
      userId: ctx.user.id,
      action: "organization.billing",
      entity: "ml_organizations",
      entityId: ctx.org.organizationId,
      details: { billingMethod: input.data.billingMethod },
    });
  });
  revalidatePath("/", "layout");
  redirect(`${BACK}?ilmoitus=tallennettu`);
}

export async function createAreaAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ name: z.string().min(1, "Anna alueen nimi.").max(100) }), formData, BACK);
  try {
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>("insert into ml_areas (organization_id, name) values ($1, $2) returning id", [
        ctx.org.organizationId,
        input.name,
      ]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "area.create", entity: "ml_areas", entityId: row.id });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(BACK, "Samanniminen alue on jo olemassa.");
    throw err;
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function renameAreaAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ areaId: z.string().uuid(), name: z.string().min(1, "Anna alueen nimi.").max(100) }), formData, BACK);
  try {
    await ctx.run(async (tx) => {
      await tx.query("update ml_areas set name = $3 where id = $1 and organization_id = $2", [input.areaId, ctx.org.organizationId, input.name]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "area.rename", entity: "ml_areas", entityId: input.areaId });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(BACK, "Samanniminen alue on jo olemassa.");
    throw err;
  }
  revalidatePath(BACK);
  redirect(BACK);
}

const roleSchema = z.enum(["owner", "staff", "reader"]);

export async function addMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(
    z.object({
      email: z.string().email("Tarkista sähköpostiosoite.").max(200),
      fullName: z.preprocess((v) => (v === "" ? null : v), z.string().max(200).nullable()),
      role: roleSchema,
    }),
    formData,
    BACK,
  );
  try {
    await addMember(ctx.db, ctx.user.sub, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input });
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ilmoitus=kayttaja`);
}

export async function changeMemberRoleAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ userId: z.string().uuid(), role: roleSchema }), formData, BACK);
  try {
    await ctx.run((tx) => changeMemberRole(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ userId: z.string().uuid() }), formData, BACK);
  try {
    await ctx.run((tx) => removeMember(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(BACK);
}
