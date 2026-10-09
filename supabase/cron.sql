-- Frequent jobs via Supabase pg_cron + pg_net (free), because Vercel Hobby only allows
-- cron jobs that run once a day. The daily 08:45 IST digest stays in vercel.json.
-- If you move to Vercel Pro, delete these jobs and add the two paths to vercel.json instead:
--   { "path": "/api/cron/ack-check",    "schedule": "*/15 * * * *" }
--   { "path": "/api/cron/hubspot-sync", "schedule": "0 * * * *" }
--
-- Setup: Database → Extensions → enable pg_cron and pg_net. Then replace the two
-- placeholders below and run this in the SQL editor.
--   <APP_URL>      e.g. https://aangan-enquiry-agent.vercel.app
--   <CRON_SECRET>  same value as the CRON_SECRET env var in Vercel

select vault.create_secret('<CRON_SECRET>', 'aangan_cron_secret');

select cron.schedule(
  'aangan-ack-check',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/ack-check',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'aangan_cron_secret')),
    timeout_milliseconds := 55000
  );
  $$
);

select cron.schedule(
  'aangan-hubspot-sync',
  '0 * * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/hubspot-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'aangan_cron_secret')),
    timeout_milliseconds := 55000
  );
  $$
);
