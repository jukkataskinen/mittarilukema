"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { normalizePhone } from "@/lib/validation/phone";
import { isValidBusinessId, normalizeBusinessId } from "@/lib/validation/finnish";
import { audit } from "@/lib/audit";
import { channelProblems, INVOICE_CHANNELS } from "@/lib/fennoa/channel";

const optionalText = (max = 200) => z.preprocess(emptyToNull, z.string().max(max).nullable());

const customerSchema = z.object({
  kind: z.enum(["person", "company"]),
  name: z.string().min(1, "Anna asiakkaan nimi.").max(200),
  customerNumber: optionalText(40),
  businessId: optionalText(20),
  email: z.preprocess(emptyToNull, z.string().email("Tarkista sähköpostiosoite.").max(200).nullable()),
  phone: optionalText(40),
  billingStreet: optionalText(200),
  billingPostalCode: z.preprocess(emptyToNull, z.string().regex(/^\d{5}$/, "Postinumero on viisi numeroa.").nullable()),
  billingCity: optionalText(100),
  einvoiceAddress: optionalText(60),
  einvoiceOperator: optionalText(60),
  invoiceChannel: z.preprocess(emptyToNull, z.enum(INVOICE_CHANNELS).nullable()),
  notes: optionalText(2000),
});

function customerValues(input: z.infer<typeof customerSchema>, backTo: string) {
  let phone: string | null = null;
  if (input.phone) {
    phone = normalizePhone(input.phone);
    if (!phone) fail(backTo, "Tarkista puhelinnumero, esimerkiksi 040 123 4567.");
  }
  let businessId: string | null = null;
  if (input.businessId) {
    businessId = normalizeBusinessId(input.businessId);
    if (!isValidBusinessId(businessId)) fail(backTo, "Y-tunnus ei ole oikeaa muotoa.");
  }
  // Valitun laskukanavan tiedot tarkistetaan jo tallennettaessa (osoite tarkistetaan viennissä).
  if (input.invoiceChannel) {
    const problems = channelProblems(
      {
        kind: input.kind, name: input.name, email: input.email, invoice_channel: input.invoiceChannel, einvoice_address: input.einvoiceAddress,
        einvoice_operator: input.einvoiceOperator, billing_street: input.billingStreet, billing_postal_code: input.billingPostalCode, billing_city: input.billingCity,
      },
      { address: false },
    );
    if (problems.length) fail(backTo, problems[0]);
  }
  return [
    input.customerNumber,
    input.kind,
    input.name,
    businessId,
    input.email,
    phone,
    input.billingStreet,
    input.billingPostalCode,
    input.billingCity,
    input.einvoiceAddress,
    input.einvoiceOperator,
    input.notes,
    input.invoiceChannel,
  ];
}

export async function createCustomerAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const backTo = "/asiakkaat/uusi";
  const input = parseForm(customerSchema, formData, backTo);
  const values = customerValues(input, backTo);
  let id = "";
  try {
    id = await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into ml_customers (organization_id, customer_number, kind, name, business_id, email, phone, billing_street,
                                   billing_postal_code, billing_city, einvoice_address, einvoice_operator, notes, invoice_channel,
                                   invoice_channel_source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, case when $14::text is null then null else 'Toimisto' end) returning id`,
        [ctx.org.organizationId, ...values],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "customer.create", entity: "ml_customers", entityId: row.id });
      return row.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(backTo, "Asiakasnumero on jo käytössä.");
    throw err;
  }
  revalidatePath("/asiakkaat");
  redirect(`/asiakkaat/${id}`);
}

export async function updateCustomerAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = z.string().uuid().parse(formData.get("customerId"));
  const backTo = `/asiakkaat/${id}/muokkaa`;
  const input = parseForm(customerSchema, formData, backTo);
  const values = customerValues(input, backTo);
  try {
    await ctx.run(async (tx) => {
      const rows = await tx.query(
        `update ml_customers set customer_number = $3, kind = $4, name = $5, business_id = $6, email = $7, phone = $8,
                billing_street = $9, billing_postal_code = $10, billing_city = $11, einvoice_address = $12,
                einvoice_operator = $13, notes = $14,
                invoice_channel_source = case when invoice_channel is not distinct from $15 then invoice_channel_source
                                              when $15::text is null then null else 'Toimisto' end,
                invoice_channel = $15
          where id = $1 and organization_id = $2 returning id`,
        [id, ctx.org.organizationId, ...values],
      );
      if (rows.length === 0) fail("/asiakkaat", "Asiakasta ei löytynyt.");
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "customer.update", entity: "ml_customers", entityId: id });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(backTo, "Asiakasnumero on jo käytössä.");
    throw err;
  }
  revalidatePath(`/asiakkaat/${id}`);
  redirect(`/asiakkaat/${id}`);
}
