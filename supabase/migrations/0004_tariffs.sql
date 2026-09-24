-- 0004 Hinnasto.
--
-- Maksulajit: perusmaksu (alueittain), käyttömaksu €/m³, Kärkisessä lisäksi
-- lainaosuus ja lisäperusmaksu. Hinnat ilman arvonlisäveroa; vero erikseen,
-- koska kanta voi muuttua kesken hinnan voimassaolon.
-- Lainaosuuden laskentatapa on vielä auki (BLOCKERS 3), joten sen yksikkö
-- valitaan tässä vapaasti ja tarkennetaan myöhemmin.

create table ml_tariffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  -- null = koko organisaatio; muuten vain tämän alueen kiinteistöt.
  area_id uuid references ml_areas(id) on delete cascade,
  charge_type text not null check (charge_type in ('basic_fee', 'usage_fee', 'loan_share', 'extra_basic_fee', 'other')),
  -- null = ei liittymälajikohtainen (esim. lainaosuus).
  connection_kind text check (connection_kind in ('water', 'wastewater')),
  name text not null,
  unit text not null check (unit in ('m3', 'month', 'year', 'piece')),
  price_eur numeric(12, 4) not null check (price_eur >= 0),
  vat_percent numeric(5, 2) not null default 25.5 check (vat_percent >= 0),
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  check (charge_type <> 'usage_fee' or unit = 'm3')
);
create index ml_tariffs_org on ml_tariffs (organization_id, charge_type, valid_from desc);
-- Sama hinta ei saa olla voimassa kahdesti päällekkäin samalla alueella.
alter table ml_tariffs add constraint ml_tariffs_no_overlap exclude using gist (
  organization_id with =,
  coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
  charge_type with =,
  coalesce(connection_kind, '') with =,
  name with =,
  daterange(valid_from, valid_to, '[]') with &&
);

alter table ml_tariffs enable row level security;
create policy members_read on ml_tariffs for select to authenticated
  using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_tariffs for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_tariffs to authenticated;
grant all on ml_tariffs to service_role;

create trigger ml_tariffs_area_same_org before insert or update on ml_tariffs
  for each row execute function ml_check_same_org('ml_areas', 'area_id');
