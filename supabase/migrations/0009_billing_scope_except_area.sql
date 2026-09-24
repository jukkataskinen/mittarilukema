-- 0009 Laskutusajon rajaus "kaikki paitsi alue".
--
-- Joutsan kiinteistöt jaetaan alueisiin 1–9 käyttöpaikan tunnuksen (Unes)
-- ensimmäisen numeron mukaan (Jukka 25.9.2026). Alue 9 on Rutalahti, jolla
-- on oma laskutusjakso, joten pääajo tehdään rajauksella "kaikki paitsi Rutalahti".

alter table ml_billing_runs drop constraint ml_billing_runs_scope_check;
alter table ml_billing_runs add constraint ml_billing_runs_scope_check check (scope in ('all', 'area', 'no_area', 'except_area'));
alter table ml_billing_runs drop constraint ml_billing_runs_check1;
alter table ml_billing_runs add constraint ml_billing_runs_area_scope check ((scope in ('area', 'except_area')) = (area_id is not null));
