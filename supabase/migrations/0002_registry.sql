-- 0002 Rekisteri: alueet, kiinteistöt, liittymät, mittarit, asiakkaat ja
-- sopimukset.
--
-- Luonnos PLAN.md:n tietomallin rungosta. Tarkennetaan, kun mittarilukema.fi:n
-- tietokannan rakenne on saatu (BLOCKERS 1). `legacy_id` on vanhan järjestelmän
-- tunniste tiedonsiirtoa ja rinnakkaisajon vertailua varten.

-- ---------------------------------------------------------------------------
-- Alueet (perusmaksu voi olla aluekohtainen)
-- ---------------------------------------------------------------------------
create table ml_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Kiinteistöt
-- ---------------------------------------------------------------------------
create table ml_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  area_id uuid references ml_areas(id) on delete set null,
  property_code text,
  street_address text not null,
  postal_code text,
  city text,
  -- Kiinteistökohtainen poikkeus organisaation laskutustavasta: Kärkisessä
  -- etäluettavalla mittarilla varustettu kiinteistö voi siirtyä toteutuneen
  -- kulutuksen laskutukseen ennen muita (DECISIONS 24.9.2026).
  billing_method text check (billing_method in ('actual', 'estimate')),
  -- Arviolaskun perusta uudelle liittymälle, jolla ei ole edellisen vuoden kulutusta.
  estimated_annual_m3 numeric(10, 2) check (estimated_annual_m3 >= 0),
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, legacy_id)
);
create index ml_properties_org on ml_properties (organization_id, street_address);

-- ---------------------------------------------------------------------------
-- Liittymät: puhdas vesi ja jätevesi erikseen
-- ---------------------------------------------------------------------------
create table ml_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete cascade,
  kind text not null check (kind in ('water', 'wastewater')),
  connected_on date not null,
  disconnected_on date,
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  check (disconnected_on is null or disconnected_on >= connected_on)
);
-- Kiinteistöllä on kerrallaan yksi voimassa oleva liittymä kutakin lajia.
create unique index ml_connections_active on ml_connections (property_id, kind) where disconnected_on is null;

-- ---------------------------------------------------------------------------
-- Mittarit
-- ---------------------------------------------------------------------------
create table ml_meters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  connection_id uuid not null references ml_connections(id) on delete cascade,
  meter_number text,
  read_method text not null check (read_method in ('remote', 'mechanical')),
  location text,
  installed_on date not null,
  -- Aloituslukema: asennuksen lukema tai viimeksi laskutettu lukema ennen
  -- tätä järjestelmää. Ensimmäinen laskutus laskee kulutuksen tästä.
  start_reading numeric(12, 3) not null default 0 check (start_reading >= 0),
  -- Mittarin vaihto: vanhan loppulukema laskutetaan vielä seuraavalla kierroksella.
  removed_on date,
  final_reading numeric(12, 3) check (final_reading >= 0),
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  check (removed_on is null or removed_on >= installed_on),
  check ((removed_on is null) = (final_reading is null))
);
create index ml_meters_connection on ml_meters (connection_id);
create index ml_meters_number on ml_meters (organization_id, meter_number);

-- ---------------------------------------------------------------------------
-- Asiakkaat
-- ---------------------------------------------------------------------------
create table ml_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  customer_number text,
  kind text not null default 'person' check (kind in ('person', 'company')),
  name text not null,
  business_id text,
  email text,
  -- Puhelinnumero kansainvälisessä muodossa (+358...). Tekstiviestilukema
  -- yhdistetään asiakkaaseen tällä, joten muoto on yksi ja sama.
  phone text check (phone is null or phone ~ '^\+[0-9]{7,15}$'),
  billing_street text,
  billing_postal_code text,
  billing_city text,
  einvoice_address text,
  einvoice_operator text,
  fennoa_customer_id text,
  notes text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_number),
  unique (organization_id, legacy_id)
);
create index ml_customers_name on ml_customers (organization_id, lower(name));
create index ml_customers_phone on ml_customers (organization_id, phone);

-- ---------------------------------------------------------------------------
-- Sopimukset: kuka maksaa mistäkin kiinteistöstä ja mistä mihin
-- ---------------------------------------------------------------------------
create table ml_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete cascade,
  customer_id uuid not null references ml_customers(id) on delete restrict,
  -- owner = kiinteistön omistaja, tenant = vuokralainen käyttösopimuksella.
  role text not null check (role in ('owner', 'tenant')),
  -- Laskutettava sopimus. Omistaja voi olla kirjattuna, vaikka vuokralainen maksaa.
  billed boolean not null default true,
  starts_on date not null,
  ends_on date,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index ml_contracts_property on ml_contracts (property_id, starts_on desc);
create index ml_contracts_customer on ml_contracts (customer_id);
-- Kiinteistöllä on samana päivänä enintään yksi laskutettava sopimus.
alter table ml_contracts add constraint ml_contracts_one_billed exclude using gist (
  property_id with =,
  daterange(starts_on, ends_on, '[]') with &&
) where (billed);

-- ---------------------------------------------------------------------------
-- RLS: organisaation jäsenet lukevat, pääkäyttäjä ja toimisto muokkaavat.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ml_areas', 'ml_properties', 'ml_connections', 'ml_meters', 'ml_customers', 'ml_contracts'] loop
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

create trigger ml_properties_touch before update on ml_properties for each row execute function ml_touch_updated_at();
create trigger ml_customers_touch before update on ml_customers for each row execute function ml_touch_updated_at();
