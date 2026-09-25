-- 0019 Vanhassa järjestelmässä laskutetut arviot tasausta varten.
--
-- Kärkinen laskuttaa vuoden 2026 kuukausiarviot vanhalla järjestelmällä,
-- mutta vuoden 2026 tasaus (huhtikuu 2027) tehdään Mittarilukemalla. Tasaus
-- vähentää arvioilla laskutetut eurot, joten vanhan järjestelmän laskuilta
-- luetut arviot tallennetaan kiinteistöittäin, kuukausittain ja
-- liittymälajeittain. Kuukausi, jolta laskuja ei ole (esim. helmikuu), voidaan
-- päätellä viereisistä kuukausista (source = inferred); epävarma merkitään
-- tarkistettavaksi. Tasaus ei laske kuukautta, jolle on myös hyväksytty
-- Mittarilukeman arviolasku, jottei samaa kuukautta vähennetä kahdesti.
create table ml_legacy_billed_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  property_id uuid not null references ml_properties(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  connection_kind text not null check (connection_kind in ('water', 'wastewater')),
  m3 numeric(12, 3) not null,
  net_eur numeric(12, 2) not null,
  gross_eur numeric(12, 2) not null,
  source text not null check (source in ('invoice', 'inferred')),
  source_file text,
  needs_review boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  unique (property_id, month, connection_kind)
);
create index ml_legacy_billed_estimates_org on ml_legacy_billed_estimates (organization_id, month);

alter table ml_legacy_billed_estimates enable row level security;
create policy members_read on ml_legacy_billed_estimates for select to authenticated using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_legacy_billed_estimates for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_legacy_billed_estimates to authenticated;
grant all on ml_legacy_billed_estimates to service_role;
create trigger ml_legacy_billed_estimates_same_org before insert or update on ml_legacy_billed_estimates
  for each row execute function ml_check_same_org('ml_properties', 'property_id');
