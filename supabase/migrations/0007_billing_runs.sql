-- 0007 Laskutusajot, laskut ja laskurivit.
--
-- Laskutusajo laskee jakson laskut kaikille kiinteistöille, joilla on
-- laskutettava sopimus (src/lib/billing/run.ts). Luonnoksen voi poistaa ja
-- laskea uudelleen; hyväksytty ajo lukitaan. Vientiä Fennoaan ei ole vielä
-- (DECISIONS 25.9.2026): laskut tarkistetaan tässä ennen kuin mitään lähetetään.

create table ml_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  -- Rajaus: kaikki kiinteistöt, yksi alue tai kiinteistöt ilman aluetta.
  -- Joutsassa Rutalahti laskutetaan eri jaksolla kuin muut (DECISIONS 25.9.2026).
  scope text not null default 'all' check (scope in ('all', 'area', 'no_area')),
  area_id uuid references ml_areas(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  note text,
  created_by uuid references ml_users(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references ml_users(id) on delete set null,
  approved_at timestamptz,
  check (period_end > period_start),
  check ((scope = 'area') = (area_id is not null)),
  check ((status = 'approved') = (approved_at is not null))
);
-- Samalle jaksolle ja rajaukselle yksi ajo kerrallaan.
create unique index ml_billing_runs_period on ml_billing_runs
  (organization_id, period_start, period_end, scope, coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table ml_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  run_id uuid not null references ml_billing_runs(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete restrict,
  customer_id uuid references ml_customers(id) on delete restrict,
  contract_id uuid references ml_contracts(id) on delete set null,
  -- excluded = jätetty pois tästä ajosta käsin (esim. loppulasku tehdään erikseen).
  status text not null default 'draft' check (status in ('draft', 'excluded')),
  water_m3 numeric(12, 3) not null default 0,
  wastewater_m3 numeric(12, 3) not null default 0,
  net_eur numeric(12, 2) not null default 0,
  vat_eur numeric(12, 2) not null default 0,
  gross_eur numeric(12, 2) not null default 0,
  -- Mittarikohtainen kulutus laskun perusteluksi: mittari, lukemat ja m³.
  usage jsonb not null default '[]',
  issues text[] not null default '{}',
  excluded_reason text,
  created_at timestamptz not null default now(),
  unique (run_id, property_id)
);
create index ml_invoices_run on ml_invoices (run_id);
create index ml_invoices_customer on ml_invoices (customer_id);

create table ml_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  invoice_id uuid not null references ml_invoices(id) on delete cascade,
  line_no smallint not null,
  kind text not null check (kind in ('usage', 'basic_fee')),
  connection_kind text not null check (connection_kind in ('water', 'wastewater')),
  description text not null,
  quantity numeric(12, 3) not null,
  unit text not null check (unit in ('m3', 'month')),
  unit_price numeric(12, 4) not null,
  vat_percent numeric(5, 2) not null,
  net_eur numeric(12, 2) not null,
  unique (invoice_id, line_no)
);

-- ---------------------------------------------------------------------------
-- RLS: jäsenet lukevat, pääkäyttäjä ja toimisto laskuttavat.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ml_billing_runs', 'ml_invoices', 'ml_invoice_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy members_read on %I for select to authenticated using (organization_id in (select ml_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (ml_has_org_role(organization_id, array[''owner'',''staff'']))
         with check (ml_has_org_role(organization_id, array[''owner'',''staff'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

create trigger ml_invoices_run_same_org before insert or update on ml_invoices
  for each row execute function ml_check_same_org('ml_billing_runs', 'run_id');
create trigger ml_invoices_property_same_org before insert or update on ml_invoices
  for each row execute function ml_check_same_org('ml_properties', 'property_id');
create trigger ml_invoices_customer_same_org before insert or update on ml_invoices
  for each row execute function ml_check_same_org('ml_customers', 'customer_id');
create trigger ml_invoice_lines_same_org before insert or update on ml_invoice_lines
  for each row execute function ml_check_same_org('ml_invoices', 'invoice_id');

-- Hyväksytty ajo on lukittu: sen laskuja ja rivejä ei muuteta eikä poisteta.
create or replace function ml_billing_run_locked() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  st text;
begin
  if tg_table_name = 'ml_billing_runs' then
    if old.status = 'approved' then
      raise exception 'Hyväksyttyä laskutusajoa ei voi muuttaa' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_table_name = 'ml_invoices' then
    rid := coalesce(new.run_id, old.run_id);
  else
    select run_id into rid from ml_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  end if;
  select status into st from ml_billing_runs where id = rid;
  if st = 'approved' then
    raise exception 'Hyväksytyn laskutusajon laskuja ei voi muuttaa' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger ml_billing_runs_locked before update or delete on ml_billing_runs
  for each row execute function ml_billing_run_locked();
create trigger ml_invoices_locked before insert or update or delete on ml_invoices
  for each row execute function ml_billing_run_locked();
create trigger ml_invoice_lines_locked before insert or update or delete on ml_invoice_lines
  for each row execute function ml_billing_run_locked();
