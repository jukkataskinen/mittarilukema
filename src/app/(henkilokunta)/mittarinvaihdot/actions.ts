"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { applySwapBatch, CampaignError, createSwapBatch, recheckSwapBatch } from "@/lib/meters/campaign";

const MAX_BYTES = 2 * 1024 * 1024;

export async function createSwapBatchAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const back = "/mittarinvaihdot";
  const name = String(formData.get("name") ?? "").trim();
  const file = formData.get("file");
  const pasted = String(formData.get("csv") ?? "");
  let csv = pasted;
  let filename: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) fail(back, "Tiedosto on liian suuri (enintään 2 Mt).");
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Excelin CSV on usein Windows-1252-merkistöä: jos UTF-8 ei kelpaa, luetaan sillä.
    try {
      csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      csv = new TextDecoder("windows-1252").decode(bytes);
    }
    filename = file.name.slice(0, 200);
  }
  if (!csv.trim()) fail(back, "Valitse CSV-tiedosto tai liitä rivit tekstikenttään.");
  let batchId = "";
  try {
    const r = await ctx.run((tx) =>
      createSwapBatch(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, name: name || filename || "Mittarinvaihdot", filename, csv, today: isoDateHelsinki(),
      }),
    );
    batchId = r.batchId;
  } catch (err) {
    if (err instanceof CampaignError) fail(back, err.message);
    throw err;
  }
  revalidatePath(back);
  redirect(`/mittarinvaihdot/${batchId}`);
}

const idOf = (formData: FormData) => {
  const p = z.string().uuid().safeParse(formData.get("batchId"));
  if (!p.success) fail("/mittarinvaihdot", "Erää ei löytynyt.");
  return p.data;
};

export async function applySwapBatchAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const r = await ctx.run((tx) => applySwapBatch(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, batchId: id, today: isoDateHelsinki() }));
  revalidatePath(`/mittarinvaihdot/${id}`);
  redirect(`/mittarinvaihdot/${id}?kirjattu=${r.applied}&epaonnistui=${r.failed}&jaljella=${r.remaining}`);
}

export async function recheckSwapBatchAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  await ctx.run((tx) => recheckSwapBatch(tx, { organizationId: ctx.org.organizationId, batchId: id, today: isoDateHelsinki() }));
  revalidatePath(`/mittarinvaihdot/${id}`);
  redirect(`/mittarinvaihdot/${id}?tarkistettu=1`);
}

export async function deleteSwapBatchAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  // Erän voi poistaa vain, jos siitä ei ole kirjattu yhtään vaihtoa: kirjatut vaihdot jäävät rekisteriin ja tapahtumiin.
  const ok = await ctx.run(async (tx) => {
    const applied = await tx.query("select 1 from ml_meter_swap_rows where batch_id = $1 and status = 'applied' limit 1", [id]);
    if (applied.length) return false;
    await tx.query("delete from ml_meter_swap_batches where id = $1 and organization_id = $2", [id, ctx.org.organizationId]);
    return true;
  });
  if (!ok) fail(`/mittarinvaihdot/${id}`, "Erästä on jo kirjattu vaihtoja, joten sitä ei voi poistaa.");
  revalidatePath("/mittarinvaihdot");
  redirect("/mittarinvaihdot");
}
