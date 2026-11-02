-- DF2/F4 — cron de polling para agente-escriba-estado. Lee los PRs abiertos
-- por el Agente Escriba y refleja rama/pr_url/pruebas_resultado en
-- sgc.agente_aprobaciones (NUNCA toca `estado` — esa decisión es de Xaviel,
-- panel Tecnología › Agentes). Cada 10 min alcanza de sobra: el Escriba no
-- corre con tanta frecuencia como el Vigía (F3, cada 5 min).
--
-- Aditiva. No depende de que el secreto AGENTE_ESCRIBA_GITHUB_TOKEN ya exista
-- en el proyecto: la edge responde {ok:true, omitido:'github_no_configurado'}
-- mientras no esté, y el cron simplemente no hace nada (ver index.ts).

select cron.schedule('sgc-agente-escriba-estado', '*/10 * * * *', $cron$select net.http_post(
    url := '' || sgc.edge_base_url() || '/functions/v1/agente-escriba-estado',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name='infra_sync_secret')),
    body := '{}'::jsonb);$cron$);
