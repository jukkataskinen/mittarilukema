-- 0017 Kirjeet postituspalvelun (Postita) kautta.
--
-- Tiedotteen kirjeet ladataan palveluun yhtenä vahvistamattomana työnä, jonka
-- vedoksen voi tarkistaa ennen postitusta. Työn tunnus, tila ja hinta
-- tallennetaan tiedotteelle; vastaanottajat ovat työn aikana tilassa sending
-- ja vahvistuksen jälkeen printed (postitettu).
alter table ml_announcements add column letter_job_id text;
alter table ml_announcements add column letter_job_status text;
alter table ml_announcements add column letter_job_price numeric(12, 2);
alter table ml_announcements add column letter_post_class smallint check (letter_post_class in (1, 2));
alter table ml_announcements add column letter_job_mode text check (letter_job_mode in ('mock', 'postita'));
