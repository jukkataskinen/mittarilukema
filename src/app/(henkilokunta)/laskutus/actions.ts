"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { approveBillingRun, BillingRunError, createBillingRun, deleteDraftRun, setInvoiceExcluded } from "@/lib/billing/run";

const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

export async function createRunAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(
    z.object({
      periodStart: date("Anna edellinen lukemapäivä."),
      periodEnd: date("Anna jakson loppu."),
      note: z.preprocess(emptyToNull, z.string().max(500).nullable()),
      scope: z.union([z.enum(["all", "no_area"]), z.string().uuid()]),
    }),
    formData,
    "/laskutus",
  );
  let runId = "";
  try {
    const { scope, ...rest } = input;
    runId = (
      await ctx.run((tx) =>
        createBillingRun(tx, {
          organizationId: ctx.org.organizationId,
          userId: ctx.user.id,
          ...rest,
          scope: scope === "all" || scope === "no_area" ? scope : { areaId: scope },
        }),
      )
    ).runId;
  } catch (err) {
    if (err instanceof BillingRunError) fail("/laskutus", err.message);
    throw err;
  }
  revalidatePath("/laskutus");
  redirect(`/laskutus/${runId}`);
}

export async function approveRunAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const runId = z.string().uuid().parse(formData.get("runId"));
  const ok = await ctx.run((tx) => approveBillingRun(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, runId }));
  if (!ok) fail(`/laskutus/${runId}`, "Ajo on jo hyväksytty.");
  revalidatePath(`/laskutus/${runId}`);
  redirect(`/laskutus/${runId}`);
}

export async function deleteRunAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const runId = z.string().uuid().parse(formData.get("runId"));
  const ok = await ctx.run((tx) => deleteDraftRun(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, runId }));
  if (!ok) fail(`/laskutus/${runId}`, "Hyväksyttyä ajoa ei voi poistaa.");
  revalidatePath("/laskutus");
  redirect("/laskutus");
}

export async function excludeInvoiceAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = z
    .object({ invoiceId: z.string().uuid(), runId: z.string().uuid(), excluded: z.enum(["1", "0"]), reason: z.string().max(300).optional() })
    .parse({ invoiceId: formData.get("invoiceId"), runId: formData.get("runId"), excluded: formData.get("excluded"), reason: formData.get("reason") ?? undefined });
  const back = `/laskutus/${input.runId}/${input.invoiceId}`;
  try {
    await ctx.run((tx) =>
      setInvoiceExcluded(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, invoiceId: input.invoiceId,
        excluded: input.excluded === "1", reason: input.reason?.trim() || null,
      }),
    );
  } catch {
    fail(back, "Hyväksytyn ajon laskuja ei voi muuttaa.");
  }
  revalidatePath(back);
  redirect(back);
}
