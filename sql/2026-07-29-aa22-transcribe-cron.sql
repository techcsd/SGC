-- PROMPT-9 · FASE 6 — AA22: cron de transcripción (cada 10 min). Idempotente.
-- Mismo patrón net.http_post + x-sync-secret (Vault infra_sync_secret) que las demás.
-- Mientras no exista el secret STT_API_KEY, la edge no toca nada; al ponerlo,
-- la siguiente corrida procesa todos los pendientes.
do $$ begin perform cron.unschedule('sgc-transcribe-audio'); exception when others then null; end $$;
select cron.schedule('sgc-transcribe-audio', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/transcribe-audio',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb)
$cron$);
