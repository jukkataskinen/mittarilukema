-- 0020 PDF-tiedotteet.
--
-- Tiedotteet ovat usein valmiita PDF-tiedostoja. Tiedotteeseen voi liittää
-- PDF:n; sähköpostissa se on liitteenä, kirjeessä sen sivut tulevat
-- osoitteellisen saatesivun perään. Kirjoitettu teksti on silloin
-- vapaaehtoinen. Tiedosto tallennetaan kantaan (enintään 4 Mt, Vercelin
-- pyyntöraja on 4,5 Mt), jolloin se on samojen RLS-sääntöjen takana kuin tiedote.
alter table ml_announcements drop constraint ml_announcements_body_check;
alter table ml_announcements add constraint ml_announcements_body_check check (length(body) <= 20000);

create table ml_announcement_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references ml_organizations(id) on delete cascade,
  announcement_id uuid not null references ml_announcements(id) on delete cascade,
  filename text not null check (length(filename) between 1 and 200),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  pages integer not null check (pages between 1 and 50),
  data bytea not null,
  created_by uuid references ml_users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Yksi PDF tiedotetta kohden: uusi korvaa vanhan.
  unique (announcement_id)
);

alter table ml_announcement_attachments enable row level security;
create policy members_read on ml_announcement_attachments for select to authenticated using (organization_id in (select ml_my_org_ids()));
create policy staff_write on ml_announcement_attachments for all to authenticated
  using (ml_has_org_role(organization_id, array['owner', 'staff']))
  with check (ml_has_org_role(organization_id, array['owner', 'staff']));
grant select, insert, update, delete on ml_announcement_attachments to authenticated;
grant all on ml_announcement_attachments to service_role;
create trigger ml_announcement_attachments_same_org before insert or update on ml_announcement_attachments
  for each row execute function ml_check_same_org('ml_announcements', 'announcement_id');
