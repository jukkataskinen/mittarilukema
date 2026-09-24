-- 0001 Perusta: organisaatiot (vesihuoltolaitokset), käyttäjät, jäsenyydet,
-- tapahtumaloki ja RLS-apufunktiot.
--
-- Sama malli kuin eRapussa: sovellus kutsuu kantaa aina roolilla
-- `authenticated` ja käyttäjän JWT-väitteellä `sub`, joten RLS on todellinen
-- suojaus. Selaimeen ei anneta Supabasen avaimia lainkaan (DECISIONS 24.9.2026).

create extension if not exists btree_gist;

create or replace function ml_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organisaatiot ja käyttäjät
-- ---------------------------------------------------------------------------
create table ml_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_id text unique,
  -- Laskutustapa on asetus eikä koodia (DECISIONS 24.9.2026):
  -- actual = toteutunut kulutus laskutuskuukausina, estimate = arviolasku
  -- kuukausittain ja tasaus kerran vuodessa.
  billing_method text not null default 'actual' check (billing_method in ('actual', 'estimate')),
  billing_months smallint[] not null default '{3,9}',
  settlement_month smallint check (settlement_month between 1 and 12),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ml_users (
  id uuid primary key default gen_random_uuid(),
  auth_sub text not null unique,
  email text not null,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ml_users_email_lower on ml_users (lower(email));

-- owner = pääkäyttäjä, staff = toimisto (rekisteri, lukemat, laskutus),
-- reader = mittarinlukija (näkee rekisterin, kirjaa lukemia).
create table ml_org_members (
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  user_id uuid not null references ml_users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'reader')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Tapahtumaloki
-- ---------------------------------------------------------------------------
create table ml_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index ml_audit_log_org_created on ml_audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS-apufunktiot
-- ---------------------------------------------------------------------------
create or replace function ml_current_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from ml_users where auth_sub = (auth.jwt() ->> 'sub')
$$;

create or replace function ml_my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organization_id from ml_org_members where user_id = ml_current_user_id()
$$;

create or replace function ml_has_org_role(org uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ml_org_members
    where organization_id = org and user_id = ml_current_user_id() and role = any(roles)
  )
$$;

grant execute on function ml_current_user_id() to authenticated, service_role;
grant execute on function ml_my_org_ids() to authenticated, service_role;
grant execute on function ml_has_org_role(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table ml_organizations enable row level security;
alter table ml_users enable row level security;
alter table ml_org_members enable row level security;
alter table ml_audit_log enable row level security;

create policy org_members_read on ml_organizations for select to authenticated
  using (id in (select ml_my_org_ids()));
create policy org_owner_update on ml_organizations for update to authenticated
  using (ml_has_org_role(id, array['owner'])) with check (ml_has_org_role(id, array['owner']));

create policy user_self on ml_users for select to authenticated
  using (id = ml_current_user_id());
create policy user_self_update on ml_users for update to authenticated
  using (id = ml_current_user_id()) with check (id = ml_current_user_id());
create policy user_same_org on ml_users for select to authenticated
  using (id in (select user_id from ml_org_members where organization_id in (select ml_my_org_ids())));

create policy members_read on ml_org_members for select to authenticated
  using (organization_id in (select ml_my_org_ids()));
create policy members_owner_write on ml_org_members for all to authenticated
  using (ml_has_org_role(organization_id, array['owner']))
  with check (ml_has_org_role(organization_id, array['owner']));

create policy audit_read on ml_audit_log for select to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']));
create policy audit_insert on ml_audit_log for insert to authenticated
  with check (user_id = ml_current_user_id() and organization_id in (select ml_my_org_ids()));

grant select, update on ml_organizations to authenticated;
grant select, update on ml_users to authenticated;
grant select, insert, update, delete on ml_org_members to authenticated;
grant select, insert on ml_audit_log to authenticated;
grant all on ml_organizations, ml_users, ml_org_members, ml_audit_log to service_role;

create trigger ml_organizations_touch before update on ml_organizations for each row execute function ml_touch_updated_at();
create trigger ml_users_touch before update on ml_users for each row execute function ml_touch_updated_at();
