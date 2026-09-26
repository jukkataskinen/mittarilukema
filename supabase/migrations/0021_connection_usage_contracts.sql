-- 0021 Liittymissopimus ja käyttösopimus, lainan velallinen, käyttöpaikan tapahtumat.
--
-- Käyttöpaikka (ml_properties) pysyy, sen osapuolet vaihtuvat:
--   role = 'owner'  liittymissopimus omistajan kanssa. Omistaja maksaa kaiken,
--                   mitä käyttösopimus ei siirrä vuokralaiselle.
--   role = 'tenant' käyttösopimus vuokralaisen kanssa. tenant_components kertoo,
--                   mitkä laskun osat vuokralainen maksaa (yleensä vain kulutus).
-- Samalla käyttöpaikalla voi siis olla samaan aikaan yksi laskutettava
-- liittymissopimus ja yksi laskutettava käyttösopimus, ja saman jakson lasku
-- jakautuu kahdelle maksajalle.

alter table ml_contracts add column tenant_components text[] not null default '{usage}';
alter table ml_contracts add constraint ml_contracts_tenant_components check (
  tenant_components <@ array['usage', 'basic_fee', 'other_fee']::text[]
);
-- Vanhat vuokralaissopimukset laskutettiin kokonaan vuokralaiselta, joten ne
-- saavat kaikki osat, jotta jo laskutettu käytäntö ei muutu migraatiossa.
update ml_contracts set tenant_components = array['usage', 'basic_fee', 'other_fee'] where role = 'tenant';

-- Laskutettavia sopimuksia yksi kumpaakin lajia samana päivänä (aiemmin yksi yhteensä).
alter table ml_contracts drop constraint ml_contracts_one_billed;
alter table ml_contracts add constraint ml_contracts_one_billed exclude using gist (
  property_id with =,
  role with =,
  daterange(starts_on, ends_on, '[]') with &&
) where (billed);

-- Kiinteistön lainaosuuden velallinen. Tyhjä = käyttöpaikan omistaja.
-- Omistajanvaihdoksessa laina jää myyjälle, kunnes kauppakirja osoittaa sen
-- siirtyneen ostajalle; silloin velalliseksi kirjataan myyjä.
alter table ml_property_loans add column debtor_customer_id uuid references ml_customers(id) on delete restrict;
create trigger ml_property_loans_debtor_same_org before insert or update on ml_property_loans
  for each row execute function ml_check_same_org('ml_customers', 'debtor_customer_id');

-- Lasku voi jakautua samalla jaksolla omistajalle, vuokralaiselle ja lainan velalliselle.
alter table ml_invoices drop constraint ml_invoices_run_property_period;
alter table ml_invoices add constraint ml_invoices_run_property_period unique nulls not distinct (run_id, property_id, period_end, customer_id);

-- Käyttöpaikan tapahtumat: omistajanvaihdos, vuokralaisen muutto sisään ja ulos,
-- mittarinvaihto. Tapahtuma kokoaa yhteen, mitä vaihdossa päätettiin
-- (lukema, lainan kohtalo, sopimukset), jotta käyttöpaikan historia on luettavissa.
create table ml_property_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete cascade,
  kind text not null check (kind in ('ownership_change', 'tenant_in', 'tenant_out', 'meter_change')),
  event_date date not null,
  -- Tapahtuman tiedot: sopimusten, lukemien ja mittarien tunnisteet sekä päätökset (esim. lainan siirto).
  details jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index ml_property_events_property on ml_property_events (property_id, event_date desc);

alter table ml_property_events enable row level security;
create policy members_read on ml_property_events for select to authenticated using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_property_events for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_property_events to authenticated;
grant all on ml_property_events to service_role;
create trigger ml_property_events_same_org before insert or update on ml_property_events
  for each row execute function ml_check_same_org('ml_properties', 'property_id');
