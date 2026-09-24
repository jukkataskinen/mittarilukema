"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { isoDateHelsinki } from "@/lib/format";
import { recordBulkReadings } from "@/lib/readings/bulk";

/** Kierroksen lukulistan tallennus: kentät nimellä r_<mittarin tunniste>. */
export async function saveRoundSheetAction(formData: FormData) {
  const ctx = await requireStaff();
  const roundId = z.string().uuid().parse(formData.get("roundId"));
  const back = String(formData.get("backTo") ?? `/lukemat/kierros/${roundId}`);
  const safeBack = back.startsWith(`/lukemat/kierros/${roundId}`) ? back : `/lukemat/kierros/${roundId}`;
  const readOn = String(formData.get("readOn") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readOn) || readOn > isoDateHelsinki()) fail(safeBack, "Tarkista lukemapäivä.");

  const entries: { meterId: string; value: string }[] = [];
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string" || !k.startsWith("r_") || !v.trim()) continue;
    const meterId = k.slice(2);
    if (/^[0-9a-f-]{36}$/.test(meterId)) entries.push({ meterId, value: v });
  }
  if (entries.length === 0) fail(safeBack, "Yhtään lukemaa ei annettu.");

  const res = await ctx.run((tx) =>
    recordBulkReadings(tx, {
      organizationId: ctx.org.organizationId, userId: ctx.user.id, roundId, readOn,
      source: ctx.can("reader") ? "reader" : "staff", entries,
    }),
  );
  revalidatePath("/lukemat");
  const sep = safeBack.includes("?") ? "&" : "?";
  redirect(`${safeBack}${sep}tallennettu=${res.saved}&tarkistettavia=${res.needsReview}&virheita=${res.errors.length}`);
}
