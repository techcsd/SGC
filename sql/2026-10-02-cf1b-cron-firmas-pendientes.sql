-- CF1b — Cron del recordatorio de firmas pendientes (empleador/testigos ≥3 días).
-- Corre a diario y notifica al módulo legal (RPC sgc.recordar_firmas_pendientes de cf1).
select cron.schedule(
  'sgc-recordar-firmas-pendientes',
  '0 13 * * *',                       -- 13:00 UTC (09:00 RD) diario
  $cron$ select sgc.recordar_firmas_pendientes(); $cron$
);
