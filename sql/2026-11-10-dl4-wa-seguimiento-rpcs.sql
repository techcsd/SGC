-- =============================================================================
-- DL4/F4 — pequeños RPCs de soporte que la edge wa-seguimiento necesita para
-- marcar el resultado de la escalera de recordatorios (contador + vencimiento).
-- Aditivo. Depende de sql/2026-11-10-dl3-wa-seguimiento.sql.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl4-wa-seguimiento-rpcs.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

create or replace function sgc.wa_marcar_recordatorio_enviado(p_ids uuid[])
returns void
language sql security definer set search_path to 'sgc', 'pg_temp'
as $$
  update sgc.wa_hallazgos
  set ultimo_recordatorio_en = now(), recordatorios_enviados = recordatorios_enviados + 1
  where id = any(p_ids);
$$;
grant execute on function sgc.wa_marcar_recordatorio_enviado(uuid[]) to service_role;

create or replace function sgc.wa_marcar_vencido(p_ids uuid[])
returns void
language sql security definer set search_path to 'sgc', 'pg_temp'
as $$
  update sgc.wa_hallazgos
  set seguimiento = 'vencido'
  where id = any(p_ids) and seguimiento = 'activo';
$$;
grant execute on function sgc.wa_marcar_vencido(uuid[]) to service_role;

commit;
