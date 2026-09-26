-- 0023 Asiakkaan muutosilmoitukset.
--
-- Asiakas ilmoittaa kaupasta, vuokralaisen muutosta, laskutusosoitteen
-- muutoksesta tai muusta julkisella lomakkeella (/ilmoitus/<tunnus>), johon
-- pääsee QR-koodilla laskusta tai tiedotteesta. Lomake ei näytä mitään
-- rekisteristä: toimisto kohdistaa ilmoituksen käyttöpaikkaan ja käsittelee
-- sen vaihdostoiminnoilla. Tila: new, in_progress, done tai rejected.

-- Organisaation lomakkeen tunnus. Satunnainen, jotta lomakkeita ei voi arvata
-- ja tunnuksen voi vaihtaa, jos lomake joutuu roskapostin kohteeksi.
alter table ml_organizations add column change_form_token text;
update ml_organizations set change_form_token = replace(gen_random_uuid()::text, '-', '') where change_form_token is null;
alter table ml_organizations alter column change_form_token set default replace(gen_random_uuid()::text, '-', '');
alter table ml_organizations alter column change_form_token set not null;
create unique index ml_organizations_change_form_token on ml_organizations (change_form_token);

create table ml_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  kind text not null check (kind in ('sale', 'move_in', 'move_out', 'billing', 'other')),
  change_date date,
  -- Käyttöpaikka asiakkaan sanoin (osoite tai tunnus); toimisto kohdistaa property_id:hen.
  place_text text not null,
  property_id uuid references ml_properties(id) on delete set null,
  submitter_name text not null,
  submitter_role text check (submitter_role in ('seller', 'buyer', 'owner', 'tenant', 'other')),
  submitter_email text,
  submitter_phone text,
  -- Uusi osapuoli (ostaja tai vuokralainen) tai osoitteenmuutoksessa ilmoittaja itse.
  party_name text,
  party_email text,
  party_phone text,
  party_address text,
  -- Toinen osapuoli (myyjä tai omistaja), jos ilmoittaja on eri.
  other_name text,
  loan_answer text check (loan_answer in ('transfers', 'stays', 'unknown')),
  meter_number text,
  reading numeric(12, 3),
  message text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'done', 'rejected')),
  handled_by uuid,
  handled_at timestamptz,
  handled_note text,
  event_id uuid references ml_property_events(id) on delete set null,
  -- Lähettäjän IP-osoitteen tiiviste lähetysmäärien rajaamiseen; itse osoitetta ei tallenneta.
  ip_hash text,
  created_at timestamptz not null default now()
);
create index ml_change_requests_org on ml_change_requests (organization_id, status, created_at desc);
create index ml_change_requests_ip on ml_change_requests (ip_hash, created_at);

alter table ml_change_requests enable row level security;
create policy staff_read on ml_change_requests for select to authenticated using (ml_has_org_role(organization_id, array['owner', 'staff']));
create policy staff_write on ml_change_requests for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_change_requests to authenticated;
grant all on ml_change_requests to service_role;
create trigger ml_change_requests_property_same_org before insert or update on ml_change_requests
  for each row execute function ml_check_same_org('ml_properties', 'property_id');
create trigger ml_change_requests_event_same_org before insert or update on ml_change_requests
  for each row execute function ml_check_same_org('ml_property_events', 'event_id');
