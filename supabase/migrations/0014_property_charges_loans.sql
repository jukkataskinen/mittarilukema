-- 0014 Kiinteistökohtaiset maksut, lainaosuudet ja verolliset hinnat (Kärkinen).
--
-- Kärkisten veloitukset (ennakkotavoitelista 9/2026): perusmaksu kaikille
-- liittyneille, lisäperusmaksu ja liittymän lisämaksu vain osalle, lainaosuus
-- (lyhennys ja 5 % korko jäljellä olevasta) yksilöllisesti. Hinnat ovat
-- verollisia, ja vero lasketaan rivin summasta taaksepäin.

-- Verollinen hinta: rivin summa = määrä × hinta, veroton = summa / (1 + alv).
alter table ml_tariffs add column price_includes_vat boolean not null default false;

-- Arviolaskun peruste: history = edellisen vuoden lukemat ensin, manual =
-- kiinteistölle annettu arvio ensin (Kärkinen asettaa kuukausiarvion itse).
alter table ml_organizations add column estimate_basis text not null default 'history' check (estimate_basis in ('history', 'manual'));

-- Liittymä ilman omaa perusmaksua: Kärkisessä perusmaksu on kiinteistöä kohden,
-- joten vesi- ja jätevesiliittymästä vain toinen kantaa sen.
alter table ml_connections drop constraint ml_connections_fee_class_check;
alter table ml_connections add constraint ml_connections_fee_class_check
  check (fee_class in ('okt', 'dn20', 'dn25', 'dn32', 'dn40', 'dn50', 'dn65', 'none'));

-- Laskurivin arvonlisävero ja verollisuus talteen, jotta summat täsmäävät sentilleen.
alter table ml_invoice_lines add column vat_eur numeric(12, 2);
alter table ml_invoice_lines add column price_includes_vat boolean not null default false;

-- ---------------------------------------------------------------------------
-- Kiinteistön maksut: kuukausittain (month) tai kerran (once, validFrom-päivänä)
-- ---------------------------------------------------------------------------
create table ml_property_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete cascade,
  name text not null,
  unit text not null check (unit in ('month', 'once')),
  price_eur numeric(12, 4) not null,
  vat_percent numeric(5, 2) not null default 0 check (vat_percent >= 0),
  price_includes_vat boolean not null default false,
  valid_from date not null,
  valid_to date,
  legacy_code text,
  notes text,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index ml_property_charges_property on ml_property_charges (property_id);

-- ---------------------------------------------------------------------------
-- Lainaosuudet: saldo tiettynä päivänä, kuukausilyhennys ja korko.
-- Laskenta: kuukauden korko = saldo kuun alussa × korko % / 12, lyhennys =
-- kuukausierä tai viimeisenä kuukautena koko saldo.
-- ---------------------------------------------------------------------------
create table ml_property_loans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete cascade,
  balance_eur numeric(12, 2) not null check (balance_eur >= 0),
  balance_date date not null,
  monthly_amortization_eur numeric(12, 2) not null check (monthly_amortization_eur >= 0),
  interest_percent numeric(6, 3) not null default 5 check (interest_percent >= 0),
  -- Kuukausi (1. päivä), jona koko jäljellä oleva saldo peritään.
  final_month date,
  notes text,
  created_at timestamptz not null default now()
);
create index ml_property_loans_property on ml_property_loans (property_id);

do $$
declare
  t text;
begin
  foreach t in array array['ml_property_charges', 'ml_property_loans'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy members_read on %I for select to authenticated using (organization_id in (select ml_my_org_ids()))', t);
    execute format(
      'create policy staff_write on %I for all to authenticated
         using (ml_has_org_role(organization_id, array[''owner'',''staff'']))
         with check (ml_has_org_role(organization_id, array[''owner'',''staff'']))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
    execute format('create trigger %I before insert or update on %I for each row execute function ml_check_same_org(''ml_properties'', ''property_id'')', t || '_same_org', t);
  end loop;
end $$;
