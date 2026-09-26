import type { Sql } from "@/lib/db/types";

/** Vaihdoslomakkeiden yhteiset tiedot: käyttöpaikka, voimassa olevat osapuolet, lainat ja asiakkaat. */
export async function loadChangeContext(tx: Sql, orgId: string, propertyId: string, today: string) {
  const [property] = await tx.query<{ id: string; street_address: string }>(
    "select id, street_address from ml_properties where organization_id = $1 and id = $2",
    [orgId, propertyId],
  );
  if (!property) return null;
  const contracts = await tx.query<{ id: string; customer_id: string; customer_name: string; role: "owner" | "tenant"; starts_on: string; tenant_components: string[] }>(
    `select c.id, c.customer_id, cu.name as customer_name, c.role, c.starts_on::text, c.tenant_components
       from ml_contracts c join ml_customers cu on cu.id = c.customer_id
      where c.property_id = $1 and c.billed and c.starts_on <= $2 and (c.ends_on is null or c.ends_on >= $2)`,
    [propertyId, today],
  );
  const loans = await tx.query<{ id: string; balance_eur: string; balance_date: string }>(
    "select id, balance_eur::text, balance_date::text from ml_property_loans where property_id = $1 and balance_eur > 0 order by created_at",
    [propertyId],
  );
  const customers = await tx.query<{ id: string; name: string; customer_number: string | null }>(
    "select id, name, customer_number from ml_customers where organization_id = $1 order by lower(name)",
    [orgId],
  );
  return {
    property,
    owner: contracts.find((c) => c.role === "owner") ?? null,
    tenant: contracts.find((c) => c.role === "tenant") ?? null,
    loans,
    customers,
  };
}
