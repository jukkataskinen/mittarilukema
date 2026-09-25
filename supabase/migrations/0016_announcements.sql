-- 0016 Tiedotteet asiakkaille ja osakkaille.
--
-- Tiedote lähtee ensisijaisesti sähköpostilla. Jos sähköpostia ei ole (tai
-- tiedote halutaan kaikille kirjeenä), se tulostetaan ikkunakirjeeksi.
-- Vastaanottajat ja heidän osoitteensa lukitaan lähetyksen alkaessa, jotta
-- jälkikäteen näkyy, kuka sai tiedotteen ja millä tavalla.

-- Organisaation yhteystiedot tiedotteen allekirjoitukseen, kirjeen lähettäjäksi
-- ja sähköpostin vastausosoitteeksi.
alter table ml_organizations add column contact_email text;
alter table ml_organizations add column contact_phone text;
alter table ml_organizations add column postal_street text;
alter table ml_organizations add column postal_code text check (postal_code is null or postal_code ~ '^\d{5}$');
alter table ml_organizations add column postal_city text;

create table ml_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  -- payers = voimassa olevien laskutettavien sopimusten maksajat, contracts = kaikki voimassa olevat sopimusosapuolet
  audience text not null default 'payers' check (audience in ('payers', 'contracts')),
  area_id uuid references ml_areas(id) on delete set null,
  -- email_first = sähköposti, muuten kirje; letter_all = kaikille kirje (sähköposti vain, jos osoite puuttuu)
  delivery text not null default 'email_first' check (delivery in ('email_first', 'letter_all')),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent')),
  created_by uuid references ml_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid references ml_users(id) on delete set null
);
create index ml_announcements_org on ml_announcements (organization_id, created_at desc);

create table ml_announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  announcement_id uuid not null references ml_announcements(id) on delete cascade,
  customer_id uuid references ml_customers(id) on delete set null,
  channel text not null check (channel in ('email', 'letter', 'none')),
  -- Lukitushetken tiedot: nimi, sähköposti ja osoiterivit sellaisina kuin tiedote lähti.
  name text not null,
  email text,
  address_lines text[] not null default '{}',
  -- sending = lähetys aloitettu, tulosta ei kirjattu (ei lähetetä uudelleen ilman tarkistusta)
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'printed', 'unreachable')),
  message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (announcement_id, customer_id)
);
create index ml_announcement_recipients_status on ml_announcement_recipients (announcement_id, channel, status);

do $$
declare
  t text;
begin
  foreach t in array array['ml_announcements', 'ml_announcement_recipients'] loop
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
create trigger ml_announcements_area_same_org before insert or update on ml_announcements
  for each row execute function ml_check_same_org('ml_areas', 'area_id');
create trigger ml_announcement_recipients_same_org before insert or update on ml_announcement_recipients
  for each row execute function ml_check_same_org('ml_announcements', 'announcement_id');
create trigger ml_announcement_recipients_customer_same_org before insert or update on ml_announcement_recipients
  for each row execute function ml_check_same_org('ml_customers', 'customer_id');
