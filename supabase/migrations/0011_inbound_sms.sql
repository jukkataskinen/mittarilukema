-- 0011 Tekstiviestilukemat.
--
-- Asiakas ilmoittaa lukeman tekstiviestillä laitoksen numeroon (DECISIONS
-- 24.9.2026). Vastaanottajanumero kertoo organisaation, lähettäjän numero
-- asiakkaan. Yksiselitteinen lukema kirjataan suoraan, muut jäävät toimiston
-- käsiteltäviksi. Palveluntarjoaja on auki (BLOCKERS 2); vastaanotto on
-- palveluriippumaton (src/lib/sms).

alter table ml_organizations add column sms_number text unique check (sms_number is null or sms_number ~ '^\+[0-9]{7,15}$');

create table ml_inbound_sms (
  id uuid primary key default gen_random_uuid(),
  -- null, jos vastaanottajanumeroa ei tunnisteta (näkyy vain palvelun roolille).
  organization_id uuid references ml_organizations(id) on delete cascade,
  provider_message_id text unique,
  from_phone text not null,
  to_phone text,
  body text not null,
  received_at timestamptz not null default now(),
  -- recorded = lukema kirjattu, needs_review = kirjattu mutta poikkeava,
  -- unmatched = ei voitu yhdistää, handled = toimisto käsitellyt, ignored = ei lukema
  status text not null check (status in ('recorded', 'needs_review', 'unmatched', 'handled', 'ignored')),
  reason text,
  customer_id uuid references ml_customers(id) on delete set null,
  property_id uuid references ml_properties(id) on delete set null,
  reading_id uuid references ml_readings(id) on delete set null,
  reply text,
  handled_by uuid references ml_users(id) on delete set null,
  handled_at timestamptz
);
create index ml_inbound_sms_org on ml_inbound_sms (organization_id, received_at desc);

alter table ml_inbound_sms enable row level security;
create policy staff_read on ml_inbound_sms for select to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']));
create policy staff_update on ml_inbound_sms for update to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, update on ml_inbound_sms to authenticated;
grant all on ml_inbound_sms to service_role;
