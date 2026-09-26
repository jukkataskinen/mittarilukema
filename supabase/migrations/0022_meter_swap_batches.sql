-- 0022 Mittarinvaihtojen erät (etäluettavien mittarien vaihtokampanja).
--
-- Asentaja toimittaa listan tehdyistä vaihdoista: vanha mittari, vaihtopäivä,
-- vanhan loppulukema, uusi mittari ja sen aloituslukema. Lista ladataan
-- eräksi, jonka jokainen rivi tarkistetaan ja saa tilan:
--   ready    valmis vietäväksi
--   error    vaatii korjauksen (viesti kertoo miksi)
--   skipped  ohitettu, esimerkiksi vaihto on jo kirjattu
--   applied  vaihto kirjattu rekisteriin (vanha poistettu, uusi asennettu)
-- Rivit viedään vain valmiina, ja jokainen vaihto on oma kokonaisuutensa.
-- Epäonnistunut rivi ei estä muita, ja erän voi tarkistaa uudelleen, kun
-- rekisteriä on korjattu.
create table ml_meter_swap_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  name text not null,
  filename text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index ml_meter_swap_batches_org on ml_meter_swap_batches (organization_id, created_at desc);

create table ml_meter_swap_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  batch_id uuid not null references ml_meter_swap_batches(id) on delete cascade,
  row_no integer not null,
  -- Tiedoston solut sellaisinaan, jotta virheellisenkin rivin näkee.
  raw jsonb not null,
  old_meter_number text,
  place_code text,
  change_date date,
  final_reading numeric(12, 3),
  new_meter_number text,
  start_reading numeric(12, 3),
  read_method text check (read_method in ('remote', 'mechanical')),
  status text not null default 'error' check (status in ('ready', 'error', 'skipped', 'applied')),
  message text,
  old_meter_id uuid references ml_meters(id) on delete set null,
  new_meter_id uuid references ml_meters(id) on delete set null,
  applied_at timestamptz,
  unique (batch_id, row_no)
);
create index ml_meter_swap_rows_batch on ml_meter_swap_rows (batch_id, status);

do $$
declare
  t text;
begin
  foreach t in array array['ml_meter_swap_batches', 'ml_meter_swap_rows'] loop
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

create trigger ml_meter_swap_rows_batch_same_org before insert or update on ml_meter_swap_rows
  for each row execute function ml_check_same_org('ml_meter_swap_batches', 'batch_id');
create trigger ml_meter_swap_rows_old_same_org before insert or update on ml_meter_swap_rows
  for each row execute function ml_check_same_org('ml_meters', 'old_meter_id');
create trigger ml_meter_swap_rows_new_same_org before insert or update on ml_meter_swap_rows
  for each row execute function ml_check_same_org('ml_meters', 'new_meter_id');
