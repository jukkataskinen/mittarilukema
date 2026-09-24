-- 0005 Mittarin kerroin.
--
-- Teollisuusmittarin lukema kerrotaan kertoimella (Joutsassa esimerkiksi 50),
-- jotta saadaan kulutus kuutioina. Tavallisella mittarilla kerroin on 1.

alter table ml_meters add column multiplier numeric(10, 3) not null default 1 check (multiplier > 0);
