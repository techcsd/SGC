-- ============================================================================
-- Y17 — Monitoreo de Infraestructura · FASE 1 (pg_cron)
-- ============================================================================
-- Invoca las edge functions vía net.http_post con el secreto compartido
-- (infra_sync_secret en Vault). check-domains cada 2h; check-subscriptions cada
-- 12h. Idempotente (unschedule antes de reprogramar).
-- ============================================================================

do $$ begin perform cron.unschedule('sgc-check-domains'); exception when others then null; end $$;
select cron.schedule('sgc-check-domains', '0 */2 * * *', $cron$
  select net.http_post(
    url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/check-domains',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb)
$cron$);

do $$ begin perform cron.unschedule('sgc-check-subscriptions'); exception when others then null; end $$;
select cron.schedule('sgc-check-subscriptions', '0 */12 * * *', $cron$
  select net.http_post(
    url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/check-subscriptions',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb)
$cron$);
