-- 0008 Laskun lisätieto.
--
-- Laskulle tulostuva lisätieto: kulutuksen peruste mittareittain (edellinen
-- ja uusi lukema jaksoineen, käyttöpaikka) samassa muodossa kuin Joutsan
-- nykyisillä laskuilla. Muodostetaan laskutusajossa (src/lib/billing/info.ts).

alter table ml_invoices add column info text;
