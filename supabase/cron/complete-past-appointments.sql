-- =============================================================================
-- Scheduled job: "Randevu gerçekleşti" (appointment took place)
-- =============================================================================
-- What it does: every 10 minutes marks past appointments as "Randevu gerçekleşti". The application moves to "Sonuç
-- bekleniyor" by itself and the customer gets a "Randevunuz gerçekleşti" notification. Function: private.complete_past_appointments()
-- (migration 19: supabase/migrations/20261020000500_appointment_completion.sql).
--
-- SUPERSEDED: in production supabase/cron/maintenance.sql is installed; that job does the same work (plus e-mails and the
-- retention period) and removes this job. This file only remains as a record of past installations.
--
-- OPTIONAL: the app does the same work itself when admin and customer pages open. This job
-- only makes sure the transition and the customer notification happen on time even if nobody opens the site.
--
-- When to run: once in the SQL Editor, AFTER migration 19 has been run and Cron (pg_cron) has been enabled in the Supabase
-- dashboard. Running it a second time updates the job with the same name; it does not create a second job. It deletes no data.

select cron.schedule(
  'vbp-randevu-gerceklesti',
  '*/10 * * * *',
  $$select private.complete_past_appointments()$$
);

-- Result: the job's name, schedule and that it is active should appear (a single row, active = true).
select jobname, schedule, active from cron.job where jobname = 'vbp-randevu-gerceklesti';
