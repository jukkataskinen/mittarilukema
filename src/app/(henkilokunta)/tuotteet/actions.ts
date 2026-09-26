"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";

const BACK = "/tuotteet";
const text = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const uuid = z.preprocess(emptyToNull, z.string().uuid().nullable());
const decimal = z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v.replace(",", ".").trim()) : null), z.number().finite().nullable());

const productSchema = z.object({
  productId: uuid,
  code: z.string().trim().min(1, "Anna tuotekoodi.").max(40),
  name: z.string().trim().min(1, "Anna tuotteen nimi.").max(200),
  unit: text(20),
  defaultPrice: decimal,
  vatPercent: decimal,
  accountId: uuid,
  costCenterId: uuid,
  active: z.preprocess((v) => v === "on", z.boolean()),
  autoMatch: z.preprocess((v) => v === "on", z.boolean()),
  matchChargeType: z.preprocess(emptyToNull, z.enum(["usage_fee", "basic_fee", "extra_basic_fee", "loan_share", "other"]).nullable()),
  matchConnectionKind: z.preprocess(emptyToNull, z.enum(["water", "wastewater"]).nullable()),
  matchFeeClass: text(20),
  matchAreaId: uuid,
  matchCustomerGroup: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() || null : null), z.string().max(40).nullable()),
  matchMetered: z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable()),
  notes: text(2000),
});

export async function saveProductAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = String(formData.get("productId") ?? "");
  const back = id ? `${BACK}/${id}` : `${BACK}/uusi`;
  const i = parseForm(productSchema, formData, back);
  // Automaattinen valinta ilman yhtään ehtoa sopisi kaikille riveille, mikä on lähes aina virhe.
  if (i.autoMatch && !i.matchChargeType) fail(back, "Valitse vähintään maksulaji, jos tuote valitaan laskuille automaattisesti.");
  const values = [
    i.code, i.name, i.unit, i.defaultPrice, i.vatPercent, i.accountId, i.costCenterId, i.active, i.autoMatch, i.matchChargeType, i.matchConnectionKind,
    i.matchFeeClass?.toLowerCase() ?? null, i.matchAreaId, i.matchCustomerGroup, i.matchMetered, i.notes,
  ];
  let savedId = i.productId;
  try {
    savedId = await ctx.run(async (tx) => {
      const [row] = i.productId
        ? await tx.query<{ id: string }>(
            `update ml_products set code = $3, name = $4, unit = $5, default_price_eur = $6, vat_percent = $7, account_id = $8, cost_center_id = $9,
                    active = $10, auto_match = $11, match_charge_type = $12, match_connection_kind = $13, match_fee_class = $14, match_area_id = $15,
                    match_customer_group = $16, match_metered = $17, notes = $18
              where id = $1 and organization_id = $2 returning id`,
            [i.productId, ctx.org.organizationId, ...values],
          )
        : await tx.query<{ id: string }>(
            `insert into ml_products (organization_id, code, name, unit, default_price_eur, vat_percent, account_id, cost_center_id, active, auto_match,
                                      match_charge_type, match_connection_kind, match_fee_class, match_area_id, match_customer_group, match_metered, notes)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
            [ctx.org.organizationId, ...values],
          );
      if (!row) fail(back, "Tuotetta ei löytynyt.");
      await audit(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, action: i.productId ? "product.update" : "product.create", entity: "ml_products", entityId: row.id,
      });
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(back, "Tuotekoodi on jo käytössä.");
    throw err;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?tallennettu=${encodeURIComponent(i.code)}#${savedId}`);
}

export async function saveAccountAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const i = parseForm(z.object({ code: z.string().trim().min(1, "Anna tilin numero.").max(20), name: text(200) }), formData, BACK);
  await ctx.run(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into ml_accounts (organization_id, code, name) values ($1, $2, $3)
       on conflict (organization_id, code) do update set name = excluded.name returning id`,
      [ctx.org.organizationId, i.code, i.name],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "account.save", entity: "ml_accounts", entityId: row.id });
  });
  revalidatePath(BACK);
  redirect(`${BACK}#tilit`);
}

export async function saveCostCenterAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const i = parseForm(
    z.object({
      code: z.string().trim().min(1, "Anna laskentakohteen koodi.").max(20),
      name: z.string().trim().min(1, "Anna laskentakohteen nimi.").max(200),
      description: text(500),
      active: z.preprocess((v) => v === "on", z.boolean()),
    }),
    formData,
    BACK,
  );
  await ctx.run(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into ml_cost_centers (organization_id, code, name, description, active) values ($1, $2, $3, $4, $5)
       on conflict (organization_id, code) do update set name = excluded.name, description = excluded.description, active = excluded.active returning id`,
      [ctx.org.organizationId, i.code, i.name, i.description, i.active],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "cost_center.save", entity: "ml_cost_centers", entityId: row.id });
  });
  revalidatePath(BACK);
  redirect(`${BACK}#laskentakohteet`);
}

export async function saveFennoaDimAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const v = String(formData.get("dim") ?? "").trim().toLowerCase();
  if (v && !/^dim\d+$/.test(v)) fail(BACK, "Fennoan dimensio on muotoa dim1, dim2 …");
  await ctx.run(async (tx) => {
    await tx.query("update ml_organizations set fennoa_cost_center_dim = $2 where id = $1", [ctx.org.organizationId, v || null]);
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "organization.fennoa_dim", entity: "ml_organizations", entityId: ctx.org.organizationId });
  });
  revalidatePath(BACK);
  redirect(`${BACK}#fennoa`);
}
