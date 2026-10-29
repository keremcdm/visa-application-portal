-- =============================================================================
-- Scheduled job: "Maintenance"
-- =============================================================================
-- What it does: calls the site's /api/maintenance endpoint every 10 minutes. On this call the site does three things:
--   1. Marks past appointments as "Randevu gerçekleşti" (the application moves to "Sonuç bekleniyor", the customer is notified).
--   2. Sends notification e-mails that are pending or failed earlier (at most 5 attempts, last 2 days).
--   3. If a retention period is set in Settings → General, deletes closed applications whose period has expired (nothing if empty).
-- All three also happen without the job, but only when someone uses the site (src/server/appointment-completion.ts,
-- src/server/email/deliver.ts, src/server/retention.ts). The job makes sure they are not delayed when nobody opens the site.
--
-- Cost: Supabase's Cron (pg_cron), pg_net and Vault features are available on every plan; there is no extra charge for this job.
-- It makes about 4,300 calls a month; each one is a few small queries.
--
-- FIRST (while the site is live at its public address):
--   a. Generate a long random key (at least 24 characters). In PowerShell:
--        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--      Set this value as the CRON_SECRET environment variable in the hosting panel and redeploy the site.
--      Do NOT write the key into a chat, an e-mail or this file.
--   b. In the Supabase dashboard add two secrets with Integrations → Vault → "Add new secret":
--        vbp_site_url    → the site's live address, e.g. https://yourdomain.com (without a trailing "/")
--        vbp_cron_secret → the same key as in (a)
--   c. The required extensions (Cron = pg_cron and pg_net) are enabled by this file itself below; there is no need to enable
--      them separately in the dashboard.
-- THEN run this whole file once in the SQL Editor. Running it a second time updates the job with the same name;
-- it does not create a second job. It deletes no data.

-- Extensions: these lines do nothing if already enabled.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Result 0: NAMES of the two secrets in Vault (values are not shown). Two rows should appear; if one is missing go back to (b).
select name from vault.decrypted_secrets where name in ('vbp_site_url', 'vbp_cron_secret') order by name;

-- If the old job that only handled appointments (supabase/cron/complete-past-appointments.sql) was installed, it is removed: this
-- job does the same work. If it was not installed this line does nothing.
select cron.unschedule(jobname) from cron.job where jobname = 'vbp-randevu-gerceklesti';

select cron.schedule(
  'vbp-bakim',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'vbp_site_url'), '/') || '/api/maintenance',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vbp_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Result 1: a single row, active = true.
select jobname, schedule, active from cron.job where jobname = 'vbp-bakim';

-- Result 2 (run separately 10–15 minutes later): responses of the latest calls.
--   200 → working. 404 → the key does not match (vbp_cron_secret in Vault differs from CRON_SECRET in hosting,
--   or the site was not redeployed). Empty → pg_net is not enabled or the job has not run yet.
-- select status_code, created from net._http_response order by created desc limit 5;
