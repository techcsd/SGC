-- ─────────────────────────────────────────────────────────────────────────────
-- Intelligent Context System — background weather sync (pg_cron)
--
-- Snapshots current weather for every active obra every 3 hours via the
-- `sync-weather-obras` edge function, so sgc.weather_snapshots accumulates
-- history on its own (for BI: días perdidos por lluvia, retrasos por clima…)
-- without depending on a user opening a project.
--
-- The edge function is protected by a shared secret (x-sync-secret). The secret
-- is stored in Supabase Vault (NOT in this file / git) and read at execution
-- time, so rotating it never requires editing the cron command.
--
-- One-time manual setup already applied to prod (documented here for history):
--
--   1. Set the function secret (CLI):
--        supabase secrets set WEATHER_SYNC_SECRET=<secret> --project-ref <ref>
--   2. Store the same secret in Vault:
--        select vault.create_secret('<secret>', 'weather_sync_secret',
--          'Shared secret for sync-weather-obras edge function cron');
--   3. Deploy: supabase functions deploy sync-weather-obras --no-verify-jwt
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (Re)schedule the 3-hourly sync. cron.schedule upserts by jobname.
select cron.schedule(
  'weather-sync-obras',
  '0 */3 * * *',
  $cmd$
    select net.http_post(
      url     := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/sync-weather-obras',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'weather_sync_secret')
      ),
      body := '{}'::jsonb
    )
  $cmd$
);

-- To inspect / unschedule:
--   select jobid, schedule, jobname, active from cron.job where jobname = 'weather-sync-obras';
--   select cron.unschedule('weather-sync-obras');
