-- 0027 Anon-roolin oikeudet pois.
--
-- Supabase antaa oletuksena roolille anon (julkinen avain) kaikki oikeudet
-- public-skeeman uusiin tauluihin, sekvensseihin ja funktioihin. Mittarilukema
-- ei käytä julkista avainta lainkaan (DECISIONS 24.9.2026, kanta vain
-- palvelimelta), joten oikeudet poistetaan. RLS suojaa ml_-taulut jo nyt,
-- mutta migraatiokirjanpidolla ml_schema_migrations ei ole RLS:ää, joten
-- julkisella avaimella olisi voinut lukea ja muuttaa sitä.

alter table ml_schema_migrations enable row level security;

do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'ml\_%' loop
    execute format('revoke all on table %I from anon', r.tablename);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'ml\_%' loop
    execute format('revoke all on sequence %I from anon', r.relname);
  end loop;
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'ml\_%' loop
    execute format('revoke all on function %s from anon, public', r.f);
  end loop;
  -- Migraatiokirjanpito vain palvelun roolille.
  revoke all on table ml_schema_migrations from authenticated;
end $$;

-- RLS-sääntöjen apufunktiot on edelleen annettava kirjautuneelle käyttäjälle
-- (0001). Triggerifunktioille (ml_touch_updated_at, ml_check_same_org,
-- ml_billing_run_locked) oikeutta ei tarvita, koska Postgres ei tarkista
-- EXECUTE-oikeutta triggerin lauetessa.
grant execute on function ml_current_user_id() to authenticated, service_role;
grant execute on function ml_my_org_ids() to authenticated, service_role;
grant execute on function ml_has_org_role(uuid, text[]) to authenticated, service_role;
