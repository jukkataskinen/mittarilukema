"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, isExclusionViolation, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista päivämäärä.");
const decimal = (msg: string) => z.string().transform((v, c) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  if (!v.trim() || Number.isNaN(n) || n < 0) {
    c.addIssue({ code: "custom", message: msg });
    return z.NEVER;
  }
  return n;
});

const tariffSchema = z.object({
  chargeType: z.enum(["basic_fee", "usage_fee", "loan_share", "extra_basic_fee", "other"]),
  connectionKind: z.preprocess(emptyToNull, z.enum(["water", "wastewater"]).nullable()),
  areaId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  name: z.string().min(1, "Anna hinnalle nimi.").max(120),
  unit: z.enum(["m3", "month", "year", "piece"]),
  price: decimal("Anna hinta euroina."),
  vatPercent: decimal("Anna arvonlisäveroprosentti."),
  validFrom: date,
  validTo: z.preprocess(emptyToNull, date.nullable()),
});

export async function createTariffAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(tariffSchema, formData, "/hinnasto");
  if (input.chargeType === "usage_fee" && input.unit !== "m3") fail("/hinnasto", "Käyttömaksun yksikkö on €/m³.");
  if (input.validTo && input.validTo < input.validFrom) fail("/hinnasto", "Voimassaolon loppu ei voi olla ennen alkua.");
  try {
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into ml_tariffs (organization_id, area_id, charge_type, connection_kind, name, unit, price_eur, vat_percent, valid_from, valid_to)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          ctx.org.organizationId,
          input.areaId,
          input.chargeType,
          input.connectionKind,
          input.name,
          input.unit,
          input.price,
          input.vatPercent,
          input.validFrom,
          input.validTo,
        ],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "tariff.create", entity: "ml_tariffs", entityId: row.id });
    });
  } catch (err) {
    if (isExclusionViolation(err)) {
      fail("/hinnasto", "Samalle ajalle on jo voimassa oleva hinta. Päätä vanha hinta ensin uuden alkua edeltävään päivään.");
    }
    throw err;
  }
  revalidatePath("/hinnasto");
  redirect("/hinnasto");
}

export async function endTariffAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const parsed = z
    .object({ tariffId: z.string().uuid(), validTo: date })
    .safeParse({ tariffId: formData.get("tariffId"), validTo: formData.get("validTo") });
  if (!parsed.success) fail("/hinnasto", "Anna päättymispäivä.");
  await ctx.run(async (tx) => {
    const rows = await tx.query(
      "update ml_tariffs set valid_to = $3 where id = $1 and organization_id = $2 and valid_from <= $3 returning id",
      [parsed.data.tariffId, ctx.org.organizationId, parsed.data.validTo],
    );
    if (rows.length === 0) fail("/hinnasto", "Päättymispäivä ei voi olla ennen voimassaolon alkua.");
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "tariff.end", entity: "ml_tariffs", entityId: parsed.data.tariffId });
  });
  revalidatePath("/hinnasto");
  redirect("/hinnasto");
}
