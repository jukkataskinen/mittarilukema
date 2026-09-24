-- 0006 Perusmaksuluokat.
--
-- Perusmaksu määräytyy liittymän luokan mukaan: omakotitalo ja vapaa-ajan
-- asunto omana luokkanaan, muut vesimittarin koon (DN) mukaan. Joutsan
-- hinnasto: https://www.joutsanvesihuolto.fi/perus-ja-kayttomaksut/
-- Luokka on liittymän tieto, ja hinnaston perusmaksurivi kertoo, mitä luokkaa
-- hinta koskee. Käyttömaksuilla luokkaa ei ole.

alter table ml_connections add column fee_class text
  check (fee_class in ('okt', 'dn20', 'dn25', 'dn32', 'dn40', 'dn50', 'dn65'));

alter table ml_tariffs add column fee_class text
  check (fee_class in ('okt', 'dn20', 'dn25', 'dn32', 'dn40', 'dn50', 'dn65'));
alter table ml_tariffs add constraint ml_tariffs_class_only_basic check (fee_class is null or charge_type = 'basic_fee');
