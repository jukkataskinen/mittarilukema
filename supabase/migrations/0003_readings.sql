-- 0003 Lukukierrokset ja lukemat.
--
-- Lukema tulee etäluennasta, tekstiviestillä, lukijalta, toimistosta,
-- lomakelinkistä tai tiedostotuonnista. Poikkeava lukema (pienempi kuin
-- edellinen, epätavallisen pieni tai suuri kulutus) jää tarkistettavaksi eikä
-- mene laskulle ennen hyväksyntää.

create table ml_reading_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  name text not null,
  -- Lukemat pyydetään tälle päivälle; muistutukset lähtevät ennen määräpäivää.
  target_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references ml_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (due_date >= target_date),
  unique (organization_id, name)
);

create table ml_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  meter_id uuid not null references ml_meters(id) on delete cascade,
  round_id uuid references ml_reading_rounds(id) on delete set null,
  read_on date not null,
  reading numeric(12, 3) not null check (reading >= 0),
  source text not null check (source in ('remote', 'sms', 'reader', 'staff', 'form', 'import', 'estimate')),
  status text not null default 'accepted' check (status in ('accepted', 'needs_review', 'rejected')),
  -- Tarkistuksen syyt (lower, small, large) sellaisina kuin ne olivat kirjattaessa.
  issues text[] not null default '{}',
  note text,
  entered_by uuid references ml_users(id) on delete set null,
  reviewed_by uuid references ml_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ml_readings_meter on ml_readings (meter_id, read_on desc);
create index ml_readings_review on ml_readings (organization_id, status) where status = 'needs_review';
-- Samalle mittarille yksi voimassa oleva lukema päivässä; hylätyt jäävät historiaan.
create unique index ml_readings_one_per_day on ml_readings (meter_id, read_on) where status <> 'rejected';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table ml_reading_rounds enable row level security;
alter table ml_readings enable row level security;

create policy members_read on ml_reading_rounds for select to authenticated
  using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_reading_rounds for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));

create policy members_read on ml_readings for select to authenticated
  using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_readings for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
-- Mittarinlukija kirjaa lukemia omissa nimissään, mutta ei hyväksy eikä poista.
create policy reader_insert on ml_readings for insert to authenticated
  with check (
    ml_has_org_role(organization_id, array['reader'])
    and source = 'reader'
    and entered_by = ml_current_user_id()
    and reviewed_by is null
  );

grant select, insert, update, delete on ml_reading_rounds, ml_readings to authenticated;
grant all on ml_reading_rounds, ml_readings to service_role;

create trigger ml_readings_touch before update on ml_readings for each row execute function ml_touch_updated_at();

-- Mittarin ja lukeman on kuuluttava samaan organisaatioon. RLS rajaa rivit
-- organisaatioittain, mutta viiteavain ei estä toisen organisaation mittarin
-- tunnisteen käyttöä; tämä estää.
create or replace function ml_check_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_org uuid;
begin
  -- Sarake luetaan jsonb:n kautta, koska sama funktio palvelee eri tauluja.
  execute format('select organization_id from %I where id = $1', tg_argv[0]) into parent_org
    using (to_jsonb(new) ->> tg_argv[1])::uuid;
  if parent_org is not null and parent_org <> new.organization_id then
    raise exception 'Viittaus toisen organisaation riviin' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger ml_readings_same_org before insert or update on ml_readings
  for each row execute function ml_check_same_org('ml_meters', 'meter_id');
create trigger ml_meters_same_org before insert or update on ml_meters
  for each row execute function ml_check_same_org('ml_connections', 'connection_id');
create trigger ml_connections_same_org before insert or update on ml_connections
  for each row execute function ml_check_same_org('ml_properties', 'property_id');
create trigger ml_contracts_property_same_org before insert or update on ml_contracts
  for each row execute function ml_check_same_org('ml_properties', 'property_id');
create trigger ml_contracts_customer_same_org before insert or update on ml_contracts
  for each row execute function ml_check_same_org('ml_customers', 'customer_id');
create trigger ml_properties_area_same_org before insert or update on ml_properties
  for each row execute function ml_check_same_org('ml_areas', 'area_id');
