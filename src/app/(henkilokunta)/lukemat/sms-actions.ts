"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { handleInboundSms } from "@/lib/sms/inbound";
import { audit } from "@/lib/audit";

const BACK = "/lukemat?tila=tekstiviestit";

export async function markSmsHandledAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = z.string().uuid().parse(formData.get("smsId"));
  await ctx.run(async (tx) => {
    await tx.query(
      "update ml_inbound_sms set status = 'handled', handled_by = $3, handled_at = now() where id = $1 and organization_id = $2 and status = 'unmatched'",
      [id, ctx.org.organizationId, ctx.user.id],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "sms.handled", entity: "ml_inbound_sms", entityId: id });
  });
  revalidatePath("/lukemat");
  redirect(BACK);
}

/**
 * Kehityskäyttöön: saapuvan viestin simulointi ilman palveluntarjoajaa.
 * Estetty tuotannossa.
 */
export async function simulateSmsAction(formData: FormData) {
  if (process.env.NODE_ENV === "production") redirect(BACK);
  const ctx = await requireRole("owner", "staff");
  const input = z.object({ from: z.string().min(3), body: z.string().min(1) }).safeParse({ from: formData.get("from"), body: formData.get("body") });
  if (!input.success) fail(BACK, "Anna lähettäjä ja viesti.");
  const [org] = await ctx.run((tx) => tx.query<{ sms_number: string | null }>("select sms_number from ml_organizations where id = $1", [ctx.org.organizationId]));
  if (!org.sms_number) fail(BACK, "Aseta ensin laitoksen tekstiviestinumero asetuksissa.");
  await handleInboundSms(ctx.db, { from: input.data.from, to: org.sms_number, body: input.data.body });
  revalidatePath("/lukemat");
  redirect(BACK);
}
