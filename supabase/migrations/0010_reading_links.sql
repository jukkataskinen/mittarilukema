-- 0010 Lukemalinkit.
--
-- Asiakas ilmoittaa lukeman linkillä ilman kirjautumista (DECISIONS 24.9.2026).
-- Linkki koskee yhtä mittaria yhdellä lukukierroksella eikä avaa pääsyä
-- muihin tietoihin. Kantaan tallennetaan vain linkin tiiviste (sha256), joten
-- kannan lukija ei voi muodostaa linkkiä. Uusi linkki samalle mittarille ja
-- kierrokselle korvaa vanhan.

create table ml_reading_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  round_id uuid not null references ml_reading_rounds(id) on delete cascade,
  meter_id uuid not null references ml_meters(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  -- Viimeisin linkin kautta ilmoitettu lukema; korjaus hylkää edellisen.
  reading_id uuid references ml_readings(id) on delete set null,
  used_at timestamptz,
  created_by uuid references ml_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (round_id, meter_id)
);

alter table ml_reading_links enable row level security;
create policy staff_read on ml_reading_links for select to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']));
create policy staff_write on ml_reading_links for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_reading_links to authenticated;
grant all on ml_reading_links to service_role;

create trigger ml_reading_links_meter_same_org before insert or update on ml_reading_links
  for each row execute function ml_check_same_org('ml_meters', 'meter_id');
create trigger ml_reading_links_round_same_org before insert or update on ml_reading_links
  for each row execute function ml_check_same_org('ml_reading_rounds', 'round_id');
