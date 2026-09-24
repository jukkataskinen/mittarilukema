-- 0012 Laskun oma jakso.
--
-- Omistajanvaihdoksessa laskutusajo tekee samalle kiinteistölle kaksi laskua:
-- loppulaskun edelliselle maksajalle vaihtopäivään asti ja laskun uudelle
-- maksajalle siitä eteenpäin. Laskulla on siksi oma jaksonsa, joka on
-- tavallisesti sama kuin ajon jakso.

alter table ml_invoices add column period_start date;
alter table ml_invoices add column period_end date;

-- Hyväksytyn ajon lukitus estäisi päivityksen; jakso vain kopioidaan ajolta.
alter table ml_invoices disable trigger ml_invoices_locked;
update ml_invoices i set period_start = r.period_start, period_end = r.period_end
  from ml_billing_runs r where r.id = i.run_id;
alter table ml_invoices enable trigger ml_invoices_locked;

alter table ml_invoices alter column period_start set not null;
alter table ml_invoices alter column period_end set not null;
alter table ml_invoices add constraint ml_invoices_period check (period_end > period_start);
alter table ml_invoices drop constraint ml_invoices_run_id_property_id_key;
alter table ml_invoices add constraint ml_invoices_run_property_period unique (run_id, property_id, period_end);
