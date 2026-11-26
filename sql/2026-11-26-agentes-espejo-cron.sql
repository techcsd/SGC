-- Espejo prod->dev de las tareas del Ingeniero: programa la edge cada 15 min (minutos 2,17,32,47, 3 min antes del despacho).
-- En dev la edge queda inerte (sin ESPEJO_DEV_*); en prod copia las tareas a dev y trae de vuelta estado/PR.
-- Reversa: sql/_reversa/2026-11-26-agentes-espejo-cron.reversa.sql
begin;
select cron.unschedule('agente-ingeniero-espejo') where exists (select 1 from cron.job where jobname = 'agente-ingeniero-espejo');
select cron.schedule('agente-ingeniero-espejo', '2,17,32,47 * * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/agente-ingeniero-espejo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);
commit;
