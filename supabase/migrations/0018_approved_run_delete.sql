-- 0018 Hyväksytyn laskutusajon poisto huoltotoimena.
--
-- Hyväksytty ajo on lukittu (0007). Virheellisesti hyväksytyn ajon voi
-- poistaa vain huoltoskriptillä (npm run laskutus:poista-hyvaksytty), joka
-- asettaa transaktiolle lipun ml.allow_approved_delete. Lippu ei vaikuta
-- sovelluksen käyttäjärooliin (authenticated), joten sovelluksen kautta
-- poisto ei ole mahdollinen. Muutokset (update) ovat edelleen estettyjä.
create or replace function ml_billing_run_locked() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  st text;
begin
  -- Huoltopoisto: vain delete, vain palveluroolilla ja vain lipun kanssa.
  if tg_op = 'DELETE' and coalesce(current_setting('ml.allow_approved_delete', true), '') = 'on'
     and session_user <> 'authenticated' and current_setting('role', true) is distinct from 'authenticated' then
    return old;
  end if;
  if tg_table_name = 'ml_billing_runs' then
    if old.status = 'approved' then
      raise exception 'Hyväksyttyä laskutusajoa ei voi muuttaa' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_table_name = 'ml_invoices' then
    rid := coalesce(new.run_id, old.run_id);
  else
    select run_id into rid from ml_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  end if;
  select status into st from ml_billing_runs where id = rid;
  if st = 'approved' then
    raise exception 'Hyväksytyn laskutusajon laskuja ei voi muuttaa' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
