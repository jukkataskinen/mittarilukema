-- 0026 Mittarittoman kiinteistön kulutus henkilöluvun tai sovitun vuosikulutuksen mukaan.
--
-- Muutamalla liittymällä ei ole mittaria. Niiltä laskutetaan kulutus
-- henkilöluvun mukaan (Joutsa: 40 m³ asukasta kohden vuodessa) tai sovitulla
-- vuosikulutuksella (arvioitu vuosikulutus, joka ohittaa henkilöluvun).
-- Laskulle tulee jakson kuukausien osuus vuosikulutuksesta.
alter table ml_properties add column occupants smallint check (occupants is null or occupants >= 0);
alter table ml_organizations add column occupant_m3_per_year numeric(8, 3) not null default 40 check (occupant_m3_per_year > 0);
