-- 0024 Tuoterekisteri, kirjanpidon tilit ja laskentakohteet.
--
-- Laskurivi viedään Fennoaan tuotekoodilla, kirjanpitotilillä ja
-- laskentakohteella (kustannuspaikka), jotta myynti kirjautuu oikein.
-- Tuotteen säännöt kertovat, mille laskuriveille se kuuluu: maksulaji,
-- liittymälaji, perusmaksuluokka, alue, asiakasryhmä ja onko mittaria.
-- Tyhjä ehto sopii kaikkiin. Laskutusajo valitsee riville tarkimmin sopivan
-- tuotteen ja tallentaa koodin, tilin ja laskentakohteen riville, jotta
-- hyväksytty lasku ei muutu, vaikka tuotetta myöhemmin muutetaan.

create table ml_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  code text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table ml_cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table ml_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  code text not null,
  name text not null,
  unit text,
  default_price_eur numeric(12, 4),
  -- Tyhjä = ei arvonlisäverollinen (esim. huomautusmaksu).
  vat_percent numeric(5, 2),
  account_id uuid references ml_accounts(id) on delete set null,
  cost_center_id uuid references ml_cost_centers(id) on delete set null,
  active boolean not null default true,
  -- Säännöt: millä laskuriveillä tuotetta käytetään automaattisesti. auto_match = false: vain käsin.
  auto_match boolean not null default false,
  match_charge_type text check (match_charge_type in ('usage_fee', 'basic_fee', 'extra_basic_fee', 'loan_share', 'other')),
  match_connection_kind text check (match_connection_kind in ('water', 'wastewater')),
  match_fee_class text,
  match_area_id uuid references ml_areas(id) on delete set null,
  match_customer_group text,
  match_metered boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index ml_products_org on ml_products (organization_id, auto_match);

-- Asiakasryhmä tuotteen valintaan, esimerkiksi "kunta".
alter table ml_customers add column customer_group text;
-- Kiinteistön oma maksu voi osoittaa suoraan tuotteeseen.
alter table ml_property_charges add column product_id uuid references ml_products(id) on delete set null;
-- Fennoan laskentakohteen dimensiotyyppi (dimension_api); tyhjä = ei viedä dimensiota erikseen.
alter table ml_organizations add column fennoa_cost_center_dim text;

-- Rivin kirjanpitotiedot laskentahetkellä.
alter table ml_invoice_lines add column product_code text;
alter table ml_invoice_lines add column account_code text;
alter table ml_invoice_lines add column cost_center_code text;

do $$
declare
  t text;
begin
  foreach t in array array['ml_accounts', 'ml_cost_centers', 'ml_products'] loop
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

create trigger ml_products_touch before update on ml_products for each row execute function ml_touch_updated_at();
create trigger ml_products_account_same_org before insert or update on ml_products
  for each row execute function ml_check_same_org('ml_accounts', 'account_id');
create trigger ml_products_cost_center_same_org before insert or update on ml_products
  for each row execute function ml_check_same_org('ml_cost_centers', 'cost_center_id');
create trigger ml_products_area_same_org before insert or update on ml_products
  for each row execute function ml_check_same_org('ml_areas', 'match_area_id');
create trigger ml_property_charges_product_same_org before insert or update on ml_property_charges
  for each row execute function ml_check_same_org('ml_products', 'product_id');
