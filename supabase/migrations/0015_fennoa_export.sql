-- 0015 Laskukanava ja laskujen vienti Fennoaan.
--
-- Laskukanava on asiakkaan oma, nimenomaisesti asetettu tieto. Oletusta ei
-- ole: kanavaton asiakas estää viennin, jottei lasku lähde hiljaa paperina
-- sille, jolle on luvattu sähköposti tai e-lasku. Lähde kertoo, mistä kanava
-- on saatu (tuonti tai toimisto), jotta sen voi tarkistaa.

alter table ml_customers add column invoice_channel text
  check (invoice_channel in ('paper', 'email', 'einvoice', 'consumer_einvoice', 'direct_payment'));
alter table ml_customers add column invoice_channel_source text;

-- ---------------------------------------------------------------------------
-- Vienti Fennoaan: yksi rivi laskua ja ympäristöä kohden. Hyväksytty ajo on
-- lukittu, joten vientitila on omassa taulussaan eikä laskulla.
--   pending   vienti aloitettu, Fennoan vastausta ei ole kirjattu (tarkistettava Fennoasta)
--   exported  lasku luotu Fennoaan ja laskukanava tarkistettu takaisin luettuna
--   mismatch  lasku luotu, mutta Fennoa tallensi eri laskukanavan tai summan
--   blocked   ei viety: laskukanava tai tiedot puutteelliset
--   failed    Fennoa hylkäsi laskun
-- ---------------------------------------------------------------------------
create table ml_fennoa_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  run_id uuid not null references ml_billing_runs(id) on delete cascade,
  invoice_id uuid not null references ml_invoices(id) on delete cascade,
  environment text not null check (environment in ('mock', 'test')),
  status text not null check (status in ('pending', 'exported', 'mismatch', 'blocked', 'failed')),
  channel text,
  delivery_method text,
  confirmed_delivery_method text,
  fennoa_invoice_id text,
  gross_eur numeric(12, 2),
  confirmed_gross_eur numeric(12, 2),
  invoice_date date,
  due_date date,
  message text,
  created_by uuid references ml_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ml_fennoa_exports_run on ml_fennoa_exports (run_id, environment);
-- Sama lasku menee Fennoaan kerran ympäristöä kohden. Myös keskeytynyt ja
-- poikkeava vienti estävät uuden, koska lasku voi jo olla Fennoassa.
create unique index ml_fennoa_exports_once on ml_fennoa_exports (invoice_id, environment)
  where status in ('pending', 'exported', 'mismatch');

alter table ml_fennoa_exports enable row level security;
create policy members_read on ml_fennoa_exports for select to authenticated using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_fennoa_exports for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_fennoa_exports to authenticated;
grant all on ml_fennoa_exports to service_role;
create trigger ml_fennoa_exports_invoice_same_org before insert or update on ml_fennoa_exports
  for each row execute function ml_check_same_org('ml_invoices', 'invoice_id');
create trigger ml_fennoa_exports_run_same_org before insert or update on ml_fennoa_exports
  for each row execute function ml_check_same_org('ml_billing_runs', 'run_id');
