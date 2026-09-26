"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail } from "@/lib/forms";
import { closeRequest, setRequestProperty } from "@/lib/change-requests";
import { audit } from "@/lib/audit";

const idOf = (formData: FormData) => {
  const p = z.string().uuid().safeParse(formData.get("requestId"));
  if (!p.success) fail("/muutosilmoitukset", "Ilmoitusta ei löytynyt.");
  return p.data;
};

export async function linkPropertyAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const back = `/muutosilmoitukset/${id}`;
  const propertyId = z.preprocess(emptyToNull, z.string().uuid().nullable()).safeParse(formData.get("propertyId"));
  if (!propertyId.success) fail(back, "Valitse käyttöpaikka.");
  const ok = await ctx.run((tx) => setRequestProperty(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, id, propertyId: propertyId.data }));
  if (!ok) fail(back, "Käsiteltyä ilmoitusta ei voi enää kohdistaa.");
  revalidatePath(back);
  redirect(back);
}

export async function closeRequestAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = idOf(formData);
  const status = z.enum(["done", "rejected", "in_progress"]).safeParse(formData.get("status"));
  if (!status.success) fail(`/muutosilmoitukset/${id}`, "Tuntematon tila.");
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000) || null;
  if (status.data === "rejected" && !note) fail(`/muutosilmoitukset/${id}`, "Kirjoita hylkäyksen syy muistiinpanoon.");
  await ctx.run((tx) => closeRequest(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, id, status: status.data, note }));
  revalidatePath("/muutosilmoitukset");
  redirect(`/muutosilmoitukset/${id}`);
}

/** Uusi lomaketunnus: vanha osoite ja QR-koodi lakkaavat toimimasta (esimerkiksi roskapostin takia). */
export async function rotateFormTokenAction() {
  const ctx = await requireRole("owner");
  await ctx.run(async (tx) => {
    await tx.query("update ml_organizations set change_form_token = replace(gen_random_uuid()::text, '-', '') where id = $1", [ctx.org.organizationId]);
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "organization.change_form_token", entity: "ml_organizations", entityId: ctx.org.organizationId });
  });
  revalidatePath("/muutosilmoitukset");
  redirect("/muutosilmoitukset?lomake=uusi");
}
