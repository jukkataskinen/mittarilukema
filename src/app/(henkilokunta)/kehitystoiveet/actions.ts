"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireStaff } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { featureOptions } from "@/lib/feature-requests";

const createSchema = z.object({
  feature: z.string().refine((v) => featureOptions().some((f) => f.value === v), "Valitse toiminto, jota toive koskee."),
  // Vain sovelluksen sisäinen polku, ettei lomakkeella voi tallentaa mitä tahansa osoitetta.
  pagePath: z.preprocess(emptyToNull, z.string().max(200).regex(/^\/[\w\-/]*$/).nullable().catch(null)),
  title: z.string().trim().min(1, "Kirjoita toiveelle lyhyt otsikko.").max(200),
  description: z.string().trim().min(1, "Kerro, mitä toivot ja miksi.").max(5000),
  importance: z.enum(["nice", "important", "blocking"]),
});

export async function createFeatureRequestAction(formData: FormData) {
  // Kaikki organisaation käyttäjät voivat jättää toiveen (käyttöoikeudet tarkennetaan myöhemmin).
  const ctx = await requireStaff();
  const i = parseForm(createSchema, formData, `/kehitystoiveet/uusi?toiminto=${encodeURIComponent(String(formData.get("feature") ?? ""))}`);
  const id = await ctx.run(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into ml_feature_requests (organization_id, created_by, feature, page_path, title, description, importance)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [ctx.org.organizationId, ctx.user.id, i.feature, i.pagePath, i.title, i.description, i.importance],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "feature_request.create", entity: "ml_feature_requests", entityId: row.id });
    return row.id;
  });
  revalidatePath("/kehitystoiveet");
  redirect(`/kehitystoiveet/${id}?kiitos=1`);
}

export async function updateFeatureRequestAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = z.string().uuid().safeParse(formData.get("requestId"));
  if (!id.success) fail("/kehitystoiveet", "Toivetta ei löytynyt.");
  const back = `/kehitystoiveet/${id.data}`;
  const i = parseForm(
    z.object({
      status: z.enum(["new", "planned", "in_progress", "done", "declined"]),
      response: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable()),
    }),
    formData,
    back,
  );
  await ctx.run(async (tx) => {
    const rows = await tx.query(
      `update ml_feature_requests set status = $3, response = $4, handled_by = $5, handled_at = now()
        where id = $1 and organization_id = $2 returning id`,
      [id.data, ctx.org.organizationId, i.status, i.response, ctx.user.id],
    );
    if (!rows.length) fail(back, "Toivetta ei löytynyt.");
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "feature_request.update", entity: "ml_feature_requests", entityId: id.data });
  });
  revalidatePath("/kehitystoiveet");
  redirect(`${back}?tallennettu=1`);
}
