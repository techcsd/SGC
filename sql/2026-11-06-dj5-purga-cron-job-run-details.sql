-- Issue #72 (parcial) -- cron.job_run_details llevaba 71,737 filas / 18 MB sin
-- purgar nunca (historial interno de pg_cron, sin dato de negocio ni
-- sensibilidad -- no toca CI13). Se acota a ESTA sola tabla: `auditoria`,
-- `domain_checks`, `notif_entregas`, `weather_snapshots` y
-- `app_error_reports` quedan fuera -- definir su ventana de retención es una
-- decision de negocio/cumplimiento, no algo para decidir sin Xaviel (ver
-- docs/PLAN-ISSUES-ABIERTOS-2026-11.md).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

create or replace function sgc.purgar_cron_job_run_details(p_dias_retener integer default 30)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, cron
as $$
declare
  v_borradas integer;
begin
  delete from cron.job_run_details
   where end_time < now() - make_interval(days => greatest(p_dias_retener, 7));
  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

revoke all on function sgc.purgar_cron_job_run_details(integer) from public, anon, authenticated;
grant execute on function sgc.purgar_cron_job_run_details(integer) to service_role;
comment on function sgc.purgar_cron_job_run_details is 'Issue #72 -- purga cron.job_run_details (historial interno de pg_cron, sin dato de negocio) a 30 días. Piso de 7 días por seguridad (nunca purga lo muy reciente aunque se llame con un número menor).';

select cron.schedule('sgc-purgar-cron-job-run-details', '30 3 * * *', $cron$select sgc.purgar_cron_job_run_details();$cron$);

commit;
