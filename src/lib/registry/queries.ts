import type { Sql } from "@/lib/db/types";

/**
 * Rekisterin lukukyselyt. Kaikki ajetaan käyttäjän RLS-transaktiossa, ja
 * organisaatio annetaan silti eksplisiittisesti: RLS on suoja, ei suodatin.
 */

export interface AreaRow {
  id: string;
  name: string;
  property_count: number;
}

export function listAreas(tx: Sql, orgId: string) {
  return tx.query<AreaRow>(
    `select a.id, a.name, (select count(*)::int from ml_properties p where p.area_id = a.id) as property_count
       from ml_areas a where a.organization_id = $1 order by a.name`,
    [orgId],
  );
}

export async function dashboardStats(tx: Sql, orgId: string) {
  const [row] = await tx.query<{
    properties: number;
    customers: number;
    meters: number;
    remote_meters: number;
    needs_review: number;
    no_billed_contract: number;
  }>(
    `select
       (select count(*)::int from ml_properties where organization_id = $1) as properties,
       (select count(*)::int from ml_customers where organization_id = $1) as customers,
       (select count(*)::int from ml_meters where organization_id = $1 and removed_on is null) as meters,
       (select count(*)::int from ml_meters where organization_id = $1 and removed_on is null and read_method = 'remote') as remote_meters,
       (select count(*)::int from ml_readings where organization_id = $1 and status = 'needs_review') as needs_review,
       (select count(*)::int from ml_properties p where p.organization_id = $1 and not exists (
          select 1 from ml_contracts c where c.property_id = p.id and c.billed
             and c.starts_on <= current_date and (c.ends_on is null or c.ends_on >= current_date))) as no_billed_contract`,
    [orgId],
  );
  return row;
}

export interface PropertyListRow {
  id: string;
  street_address: string;
  postal_code: string | null;
  city: string | null;
  area_name: string | null;
  payer: string | null;
  connections: string[] | null;
  meter_numbers: string[] | null;
}

export function listProperties(tx: Sql, orgId: string, opts: { q?: string; areaId?: string; missingPayer?: boolean; limit?: number } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;
  return tx.query<PropertyListRow>(
    `select p.id, p.street_address, p.postal_code, p.city, a.name as area_name,
            (select cu.name from ml_contracts c join ml_customers cu on cu.id = c.customer_id
              where c.property_id = p.id and c.billed and c.starts_on <= current_date
                and (c.ends_on is null or c.ends_on >= current_date) order by c.role desc limit 1) as payer,
            (select array_agg(kind order by kind) from ml_connections k where k.property_id = p.id and k.disconnected_on is null) as connections,
            (select array_agg(m.meter_number order by m.meter_number) from ml_meters m
               join ml_connections k on k.id = m.connection_id
              where k.property_id = p.id and m.removed_on is null and m.meter_number is not null) as meter_numbers
       from ml_properties p
       left join ml_areas a on a.id = p.area_id
      where p.organization_id = $1
        and ($2::uuid is null or p.area_id = $2)
        and ($3::text is null
             or lower(p.street_address) like $3
             or lower(coalesce(p.city, '')) like $3
             or lower(coalesce(p.property_code, '')) like $3
             or coalesce(p.legacy_id, '') like $3
             or exists (select 1 from ml_meters m join ml_connections k on k.id = m.connection_id
                         where k.property_id = p.id and lower(coalesce(m.meter_number, '')) like $3)
             or exists (select 1 from ml_contracts c join ml_customers cu on cu.id = c.customer_id
                         where c.property_id = p.id and lower(cu.name) like $3))
        and (not $5::boolean or not exists (
             select 1 from ml_contracts c where c.property_id = p.id and c.billed
                and c.starts_on <= current_date and (c.ends_on is null or c.ends_on >= current_date)))
      order by p.street_address
      limit $4`,
    [orgId, opts.areaId ?? null, q, opts.limit ?? 200, opts.missingPayer ?? false],
  );
}

export interface PropertyDetail {
  id: string;
  area_id: string | null;
  area_name: string | null;
  property_code: string | null;
  street_address: string;
  postal_code: string | null;
  city: string | null;
  billing_method: "actual" | "estimate" | null;
  estimated_annual_m3: string | null;
  occupants: number | null;
  notes: string | null;
  legacy_id: string | null;
}

export async function getProperty(tx: Sql, orgId: string, id: string) {
  const [property] = await tx.query<PropertyDetail>(
    `select p.id, p.area_id, a.name as area_name, p.property_code, p.street_address, p.postal_code, p.city,
            p.billing_method, p.estimated_annual_m3::text, p.occupants, p.notes, p.legacy_id
       from ml_properties p left join ml_areas a on a.id = p.area_id
      where p.organization_id = $1 and p.id = $2`,
    [orgId, id],
  );
  if (!property) return null;

  const connections = await tx.query<{ id: string; kind: "water" | "wastewater"; connected_on: string; disconnected_on: string | null }>(
    `select id, kind, connected_on::text, disconnected_on::text from ml_connections
      where property_id = $1 order by disconnected_on nulls first, kind`,
    [id],
  );
  const meters = await tx.query<{
    id: string;
    connection_id: string;
    meter_number: string | null;
    read_method: "remote" | "mechanical";
    location: string | null;
    installed_on: string;
    start_reading: string;
    removed_on: string | null;
    final_reading: string | null;
    multiplier: string;
    last_reading: string | null;
    last_read_on: string | null;
  }>(
    `select m.id, m.connection_id, m.meter_number, m.read_method, m.location, m.installed_on::text,
            m.start_reading::text, m.removed_on::text, m.final_reading::text, m.multiplier::text,
            r.reading::text as last_reading, r.read_on::text as last_read_on
       from ml_meters m
       join ml_connections k on k.id = m.connection_id
       left join lateral (select reading, read_on from ml_readings where meter_id = m.id and status = 'accepted'
                           order by read_on desc limit 1) r on true
      where k.property_id = $1
      order by m.removed_on nulls first, m.installed_on desc`,
    [id],
  );
  const contracts = await tx.query<{
    id: string;
    customer_id: string;
    customer_name: string;
    role: "owner" | "tenant";
    billed: boolean;
    starts_on: string;
    ends_on: string | null;
    tenant_components: string[];
  }>(
    `select c.id, c.customer_id, cu.name as customer_name, c.role, c.billed, c.starts_on::text, c.ends_on::text, c.tenant_components
       from ml_contracts c join ml_customers cu on cu.id = c.customer_id
      where c.property_id = $1 order by c.ends_on nulls first, c.starts_on desc`,
    [id],
  );
  const readings = await tx.query<ReadingRow>(
    `${READING_SELECT} where k.property_id = $1 order by r.read_on desc, r.created_at desc limit 50`,
    [id],
  );
  return { property, connections, meters, contracts, readings };
}

export interface CustomerListRow {
  id: string;
  customer_number: string | null;
  name: string;
  kind: "person" | "company";
  email: string | null;
  phone: string | null;
  properties: string[] | null;
}

export function listCustomers(tx: Sql, orgId: string, opts: { q?: string; limit?: number } = {}) {
  const q = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;
  return tx.query<CustomerListRow>(
    `select cu.id, cu.customer_number, cu.name, cu.kind, cu.email, cu.phone,
            (select array_agg(p.street_address order by p.street_address) from ml_contracts c
               join ml_properties p on p.id = c.property_id
              where c.customer_id = cu.id and (c.ends_on is null or c.ends_on >= current_date)) as properties
       from ml_customers cu
      where cu.organization_id = $1
        and ($2::text is null or lower(cu.name) like $2 or lower(coalesce(cu.customer_number, '')) like $2
             or lower(coalesce(cu.email, '')) like $2 or replace(coalesce(cu.phone, ''), '+358', '0') like replace($2, ' ', ''))
      order by lower(cu.name)
      limit $3`,
    [orgId, q, opts.limit ?? 200],
  );
}

export interface CustomerDetail {
  id: string;
  customer_number: string | null;
  kind: "person" | "company";
  name: string;
  business_id: string | null;
  email: string | null;
  phone: string | null;
  billing_street: string | null;
  billing_postal_code: string | null;
  billing_city: string | null;
  einvoice_address: string | null;
  einvoice_operator: string | null;
  fennoa_customer_id: string | null;
  notes: string | null;
  legacy_id: string | null;
  invoice_channel: string | null;
  invoice_channel_source: string | null;
  customer_group: string | null;
}

export async function getCustomer(tx: Sql, orgId: string, id: string) {
  const [customer] = await tx.query<CustomerDetail>(
    `select id, customer_number, kind, name, business_id, email, phone, billing_street, billing_postal_code, billing_city,
            einvoice_address, einvoice_operator, fennoa_customer_id, notes, legacy_id, invoice_channel, invoice_channel_source, customer_group
       from ml_customers where organization_id = $1 and id = $2`,
    [orgId, id],
  );
  if (!customer) return null;
  const contracts = await tx.query<{
    id: string;
    property_id: string;
    street_address: string;
    city: string | null;
    role: "owner" | "tenant";
    billed: boolean;
    starts_on: string;
    ends_on: string | null;
  }>(
    `select c.id, c.property_id, p.street_address, p.city, c.role, c.billed, c.starts_on::text, c.ends_on::text
       from ml_contracts c join ml_properties p on p.id = c.property_id
      where c.customer_id = $1 order by c.ends_on nulls first, c.starts_on desc`,
    [id],
  );
  return { customer, contracts };
}

export interface ReadingRow {
  id: string;
  meter_id: string;
  meter_number: string | null;
  property_id: string;
  street_address: string;
  read_on: string;
  reading: string;
  source: string;
  status: "accepted" | "needs_review" | "rejected";
  issues: string[];
  note: string | null;
  entered_by_name: string | null;
  previous_reading: string | null;
  multiplier: string;
}

const READING_SELECT = `
  select r.id, r.meter_id, m.meter_number, p.id as property_id, p.street_address, r.read_on::text, r.reading::text,
         r.source, r.status, r.issues, r.note, coalesce(u.full_name, u.email) as entered_by_name, m.multiplier::text,
         (select pr.reading::text from ml_readings pr where pr.meter_id = r.meter_id and pr.status = 'accepted'
             and pr.read_on < r.read_on order by pr.read_on desc limit 1) as previous_reading
    from ml_readings r
    join ml_meters m on m.id = r.meter_id
    join ml_connections k on k.id = m.connection_id
    join ml_properties p on p.id = k.property_id
    left join ml_users u on u.id = r.entered_by`;

export function listReadings(tx: Sql, orgId: string, opts: { status?: string; limit?: number } = {}) {
  return tx.query<ReadingRow>(
    `${READING_SELECT}
      where r.organization_id = $1 and ($2::text is null or r.status = $2)
      order by r.read_on desc, r.created_at desc
      limit $3`,
    [orgId, opts.status ?? null, opts.limit ?? 100],
  );
}

export interface TariffRow {
  id: string;
  area_id: string | null;
  area_name: string | null;
  charge_type: string;
  connection_kind: string | null;
  name: string;
  unit: string;
  price_eur: string;
  vat_percent: string;
  valid_from: string;
  valid_to: string | null;
}

export function listTariffs(tx: Sql, orgId: string) {
  return tx.query<TariffRow>(
    `select t.id, t.area_id, a.name as area_name, t.charge_type, t.connection_kind, t.name, t.unit,
            t.price_eur::text, t.vat_percent::text, t.valid_from::text, t.valid_to::text
       from ml_tariffs t left join ml_areas a on a.id = t.area_id
      where t.organization_id = $1
      order by (t.valid_to is not null and t.valid_to < current_date), t.charge_type, t.connection_kind nulls last, a.name nulls first, t.valid_from desc`,
    [orgId],
  );
}

export function listRounds(tx: Sql, orgId: string) {
  return tx.query<{ id: string; name: string; target_date: string; due_date: string; status: "open" | "closed"; reading_count: number }>(
    `select r.id, r.name, r.target_date::text, r.due_date::text, r.status,
            (select count(*)::int from ml_readings x where x.round_id = r.id and x.status <> 'rejected') as reading_count
       from ml_reading_rounds r where r.organization_id = $1 order by r.target_date desc`,
    [orgId],
  );
}
