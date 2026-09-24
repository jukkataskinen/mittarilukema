"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, isExclusionViolation, isUniqueViolation, parseForm } from "@/lib/forms";
import { parseReading } from "@/lib/readings/checks";
import { normalizePropertyCode } from "@/lib/validation/finnish";
import { audit } from "@/lib/audit";

const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const optionalText = (max = 200) => z.preprocess(emptyToNull, z.string().max(max).nullable());
const optionalUuid = z.preprocess(emptyToNull, z.string().uuid().nullable());

const propertySchema = z.object({
  streetAddress: z.string().min(1, "Anna katuosoite.").max(200),
  postalCode: z.preprocess(emptyToNull, z.string().regex(/^\d{5}$/, "Postinumero on viisi numeroa.").nullable()),
  city: optionalText(100),
  areaId: optionalUuid,
  propertyCode: optionalText(40),
  billingMethod: z.preprocess(emptyToNull, z.enum(["actual", "estimate"]).nullable()),
  estimatedAnnualM3: optionalText(20),
  notes: optionalText(2000),
});

function propertyValues(input: z.infer<typeof propertySchema>, backTo: string) {
  let code: string | null = null;
  if (input.propertyCode) {
    code = normalizePropertyCode(input.propertyCode);
    if (!code) fail(backTo, "Kiinteistötunnus on muotoa 172-402-4-543.");
  }
  let estimate: number | null = null;
  if (input.estimatedAnnualM3) {
    estimate = parseReading(input.estimatedAnnualM3);
    if (estimate === null) fail(backTo, "Arvioitu vuosikulutus on luku kuutioina.");
  }
  return [input.areaId, code, input.streetAddress, input.postalCode, input.city, input.billingMethod, estimate, input.notes];
}

export async function createPropertyAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const backTo = "/kiinteistot/uusi";
  const input = parseForm(propertySchema, formData, backTo);
  const values = propertyValues(input, backTo);
  const id = await ctx.run(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into ml_properties (organization_id, area_id, property_code, street_address, postal_code, city, billing_method, estimated_annual_m3, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [ctx.org.organizationId, ...values],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "property.create", entity: "ml_properties", entityId: row.id });
    return row.id;
  });
  revalidatePath("/kiinteistot");
  redirect(`/kiinteistot/${id}`);
}

export async function updatePropertyAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const id = z.string().uuid().parse(formData.get("propertyId"));
  const backTo = `/kiinteistot/${id}/muokkaa`;
  const input = parseForm(propertySchema, formData, backTo);
  const values = propertyValues(input, backTo);
  await ctx.run(async (tx) => {
    const rows = await tx.query(
      `update ml_properties set area_id = $3, property_code = $4, street_address = $5, postal_code = $6, city = $7,
              billing_method = $8, estimated_annual_m3 = $9, notes = $10
        where id = $1 and organization_id = $2 returning id`,
      [id, ctx.org.organizationId, ...values],
    );
    if (rows.length === 0) fail("/kiinteistot", "Kiinteistöä ei löytynyt.");
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "property.update", entity: "ml_properties", entityId: id });
  });
  revalidatePath(`/kiinteistot/${id}`);
  redirect(`/kiinteistot/${id}`);
}

const connectionSchema = z.object({
  propertyId: z.string().uuid(),
  kind: z.enum(["water", "wastewater"]),
  connectedOn: date("Anna liittymispäivä."),
});

export async function addConnectionAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(connectionSchema, formData, "/kiinteistot");
  const back = `/kiinteistot/${input.propertyId}`;
  try {
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        "insert into ml_connections (organization_id, property_id, kind, connected_on) values ($1, $2, $3, $4) returning id",
        [ctx.org.organizationId, input.propertyId, input.kind, input.connectedOn],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "connection.create", entity: "ml_connections", entityId: row.id });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(back, "Kiinteistöllä on jo voimassa oleva liittymä tätä lajia.");
    throw err;
  }
  revalidatePath(back);
  redirect(back);
}

const meterSchema = z.object({
  propertyId: z.string().uuid(),
  connectionId: z.string().uuid(),
  meterNumber: optionalText(60),
  readMethod: z.enum(["remote", "mechanical"]),
  location: optionalText(200),
  installedOn: date("Anna asennuspäivä."),
  startReading: z.string().min(1, "Anna aloituslukema."),
  // Mittarinvaihto: vanhan mittarin loppulukema samalle päivälle.
  replaceMeterId: optionalUuid,
  finalReading: optionalText(20),
});

export async function addMeterAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(meterSchema, formData, "/kiinteistot");
  const back = `/kiinteistot/${input.propertyId}`;
  const start = parseReading(input.startReading);
  if (start === null) fail(back, "Aloituslukema on luku, jossa on enintään kolme desimaalia.");
  let final: number | null = null;
  if (input.replaceMeterId) {
    final = input.finalReading ? parseReading(input.finalReading) : null;
    if (final === null) fail(back, "Anna vaihdettavan mittarin loppulukema.");
  }
  await ctx.run(async (tx) => {
    if (input.replaceMeterId) {
      const rows = await tx.query(
        "update ml_meters set removed_on = $3, final_reading = $4 where id = $1 and organization_id = $2 and removed_on is null returning id",
        [input.replaceMeterId, ctx.org.organizationId, input.installedOn, final],
      );
      if (rows.length === 0) fail(back, "Vaihdettavaa mittaria ei löytynyt tai se on jo poistettu.");
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "meter.remove", entity: "ml_meters", entityId: input.replaceMeterId });
    }
    const [row] = await tx.query<{ id: string }>(
      `insert into ml_meters (organization_id, connection_id, meter_number, read_method, location, installed_on, start_reading)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [ctx.org.organizationId, input.connectionId, input.meterNumber, input.readMethod, input.location, input.installedOn, start],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "meter.create", entity: "ml_meters", entityId: row.id });
  });
  revalidatePath(back);
  redirect(back);
}

const contractSchema = z.object({
  propertyId: z.string().uuid(),
  customerId: z.string().uuid({ message: "Valitse asiakas." }),
  role: z.enum(["owner", "tenant"]),
  billed: z.preprocess((v) => v === "on", z.boolean()),
  startsOn: date("Anna alkamispäivä."),
  // Edellisen laskutettavan sopimuksen päättäminen samalla kertaa (omistajanvaihdos).
  endPrevious: z.preprocess((v) => v === "on", z.boolean()),
});

export async function addContractAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = parseForm(contractSchema, formData, "/kiinteistot");
  const back = `/kiinteistot/${input.propertyId}`;
  try {
    await ctx.run(async (tx) => {
      if (input.billed && input.endPrevious) {
        await tx.query(
          `update ml_contracts set ends_on = $3::date - 1
            where property_id = $1 and organization_id = $2 and billed and starts_on < $3 and (ends_on is null or ends_on >= $3)`,
          [input.propertyId, ctx.org.organizationId, input.startsOn],
        );
      }
      const [row] = await tx.query<{ id: string }>(
        "insert into ml_contracts (organization_id, property_id, customer_id, role, billed, starts_on) values ($1, $2, $3, $4, $5, $6) returning id",
        [ctx.org.organizationId, input.propertyId, input.customerId, input.role, input.billed, input.startsOn],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "contract.create", entity: "ml_contracts", entityId: row.id });
    });
  } catch (err) {
    if (isExclusionViolation(err)) fail(back, "Kiinteistöllä on jo laskutettava sopimus tälle ajalle. Valitse, että edellinen päätetään.");
    throw err;
  }
  revalidatePath(back);
  redirect(back);
}

export async function endContractAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = z
    .object({ contractId: z.string().uuid(), propertyId: z.string().uuid(), endsOn: date("Anna päättymispäivä.") })
    .safeParse({ contractId: formData.get("contractId"), propertyId: formData.get("propertyId"), endsOn: formData.get("endsOn") });
  if (!input.success) fail("/kiinteistot", "Anna päättymispäivä.");
  const back = `/kiinteistot/${input.data.propertyId}`;
  await ctx.run(async (tx) => {
    const rows = await tx.query(
      "update ml_contracts set ends_on = $3 where id = $1 and organization_id = $2 and starts_on <= $3 returning id",
      [input.data.contractId, ctx.org.organizationId, input.data.endsOn],
    );
    if (rows.length === 0) fail(back, "Päättymispäivä ei voi olla ennen alkamispäivää.");
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "contract.end", entity: "ml_contracts", entityId: input.data.contractId });
  });
  revalidatePath(back);
  redirect(back);
}

export async function disconnectAction(formData: FormData) {
  const ctx = await requireRole("owner", "staff");
  const input = z
    .object({ connectionId: z.string().uuid(), propertyId: z.string().uuid(), disconnectedOn: date("Anna päivämäärä.") })
    .safeParse({ connectionId: formData.get("connectionId"), propertyId: formData.get("propertyId"), disconnectedOn: formData.get("disconnectedOn") });
  if (!input.success) fail("/kiinteistot", "Anna päivämäärä.");
  const back = `/kiinteistot/${input.data.propertyId}`;
  await ctx.run(async (tx) => {
    const rows = await tx.query(
      "update ml_connections set disconnected_on = $3 where id = $1 and organization_id = $2 and connected_on <= $3 returning id",
      [input.data.connectionId, ctx.org.organizationId, input.data.disconnectedOn],
    );
    if (rows.length === 0) fail(back, "Päivä ei voi olla ennen liittymispäivää.");
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "connection.end", entity: "ml_connections", entityId: input.data.connectionId });
  });
  revalidatePath(back);
  redirect(back);
}
