-- ============================================================================
-- PROMPT-9 · FASE 3 — AA20: cron semanal de precios de combustible (MICM)
-- Fecha: 2026-07-29. Idempotente.
--
-- El MICM publica el aviso de precios los VIERNES (vigencia semanal). El archivo
-- CSV estático de datos abiertos se actualiza ~semanalmente (a veces con 1–2
-- semanas de rezago). Se corre el sábado temprano para recoger el aviso del
-- viernes; si el CSV aún no reflejó la semana, el upsert es idempotente y la
-- corrida siguiente la actualiza. Mismo patrón que sgc-check-domains (net.http_post
-- + x-sync-secret desde Vault).
-- ============================================================================

do $$ begin perform cron.unschedule('sgc-fuel-prices'); exception when others then null; end $$;
select cron.schedule('sgc-fuel-prices', '0 6 * * 6', $cron$
  select net.http_post(
    url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/fuel-prices',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb)
$cron$);
