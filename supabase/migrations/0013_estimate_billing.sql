-- 0013 Arviolaskutus ja vuositasaus (Kärkinen).
--
-- Laskutusajolla on laji: actual = toteutunut kulutus (Joutsa), estimate =
-- arviolasku (kuukausi), settlement = tasaus: todellinen kulutus miinus
-- arviolaskuilla laskutettu. Laskuriveille tulevat myös muut kuukausimaksut
-- (lisäperusmaksu, lainaosuus), joilla ei ole liittymälajia.

alter table ml_billing_runs add column kind text not null default 'actual' check (kind in ('actual', 'estimate', 'settlement'));
drop index ml_billing_runs_period;
create unique index ml_billing_runs_period on ml_billing_runs
  (organization_id, kind, period_start, period_end, scope, coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table ml_invoice_lines drop constraint ml_invoice_lines_kind_check;
alter table ml_invoice_lines add constraint ml_invoice_lines_kind_check check (kind in ('usage', 'basic_fee', 'other_fee'));
alter table ml_invoice_lines drop constraint ml_invoice_lines_unit_check;
alter table ml_invoice_lines add constraint ml_invoice_lines_unit_check check (unit in ('m3', 'month', 'year'));
alter table ml_invoice_lines alter column connection_kind drop not null;

-- Arviolaskun peruste laskulle: vuosikulutusarvio ja sen lähde.
alter table ml_invoices add column estimate_annual_m3 numeric(12, 3);
alter table ml_invoices add column estimate_source text check (estimate_source in ('history', 'manual'));
