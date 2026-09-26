-- 0025 Kehitystoiveet.
--
-- Käyttäjä jättää kehitystoiveen ja valitsee toiminnon, jota toive koskee
-- (ohjesivuston toiminnot, src/lib/help/topics.ts), jotta toiveet on helppo
-- ryhmitellä ja käsitellä. Toiveen voi jättää myös suoraan toiminnon
-- sivulta, jolloin toiminto ja sivu täyttyvät valmiiksi.
--
-- Käyttöoikeudet tarkennetaan myöhemmin (Jukka 26.9.2026). Aluksi kaikki
-- organisaation jäsenet näkevät organisaation toiveet ja voivat jättää omia;
-- tilaa ja vastausta muuttavat pääkäyttäjä ja toimisto.
create table ml_feature_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  created_by uuid not null references ml_users(id) on delete restrict,
  -- Toiminnon tunnus ohjesivustolta (esim. "laskutus") tai "muu".
  feature text not null,
  -- Sivu, jolta toive jätettiin (esim. /laskutus); ei henkilötietoja, koska osoitteissa on vain tunnisteita.
  page_path text,
  title text not null check (length(title) between 1 and 200),
  description text not null check (length(description) between 1 and 5000),
  importance text not null default 'nice' check (importance in ('nice', 'important', 'blocking')),
  status text not null default 'new' check (status in ('new', 'planned', 'in_progress', 'done', 'declined')),
  response text,
  handled_by uuid references ml_users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ml_feature_requests_org on ml_feature_requests (organization_id, status, created_at desc);

alter table ml_feature_requests enable row level security;
create policy members_read on ml_feature_requests for select to authenticated using (organization_id in (select ml_my_org_ids()));
-- Jäsen jättää toiveen omissa nimissään.
create policy members_insert on ml_feature_requests for insert to authenticated
  with check (organization_id in (select ml_my_org_ids()) and created_by = ml_current_user_id());
create policy staff_update on ml_feature_requests for update to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
create policy staff_delete on ml_feature_requests for delete to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_feature_requests to authenticated;
grant all on ml_feature_requests to service_role;
create trigger ml_feature_requests_touch before update on ml_feature_requests for each row execute function ml_touch_updated_at();
