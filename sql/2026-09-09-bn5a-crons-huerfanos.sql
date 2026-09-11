-- BN5a — Rescatar al repo dos cron jobs que corren en producción pero NO estaban
-- declarados en sql/ (regla 11 del checklist: si el cron.schedule no está en sql/,
-- el trabajo no existe — se pierde en una reconstrucción y no se puede auditar).
--
--   1) sgc-incentivo-diario  (jobid 35 en prod): la migración BK4 creó la función
--      sgc.incentivo_cron_diario() pero terminó en `commit;` sin programar el cron;
--      el job se registró a mano desde el dashboard.
--   2) outbox-atascados-diario (jobid 34 en prod): su cron.schedule quedó COMENTADO
--      en 2026-09-01-bg2-outbox-telemetria.sql:247 ("HELD para Xaviel"); igualmente
--      se registró a mano.
--
-- Esta migración SÓLO declara lo que ya corre — mismo jobname, schedule y command
-- verificados contra `cron.job` el 2026-09-09. No cambia horarios ni duplica jobs
-- (cron.unschedule idempotente antes de cada schedule). RD = UTC-4 sin DST, así que
-- 0 12 * * * = 8:00 AM RD siempre.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-09-bn5a-crons-huerfanos.sql

begin;

-- 1) Incentivo diario (8am RD). La función ya existe (BK4); sólo programamos el cron.
do $$ begin perform cron.unschedule('sgc-incentivo-diario'); exception when others then null; end $$;
select cron.schedule('sgc-incentivo-diario', '0 12 * * *',
  $cron$ select sgc.incentivo_cron_diario(); $cron$);

-- 2) Resumen diario de outbox atascados (8am RD). Función ya existe (BG2).
do $$ begin perform cron.unschedule('outbox-atascados-diario'); exception when others then null; end $$;
select cron.schedule('outbox-atascados-diario', '0 12 * * *',
  $cron$ select sgc.outbox_atascados_resumen_diario(); $cron$);

commit;
