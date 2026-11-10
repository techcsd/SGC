-- =============================================================================
-- F7 (ronda DL) — RPC de lectura que Compa/MCP necesitan con los campos nuevos
-- de seguimiento/recap: wa_resumen_grupo_v2 (desde/hasta/decisiones/pendientes,
-- wa_hallazgos_listar_v2 y wa_mis_pendientes ya existen de dl3/dl3c).
-- No se toca wa_resumen_grupo (v1): sigue viva para quien aún la llame.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-10-dl-f7-compa-tools.sql --env dev
-- =============================================================================
begin;
set local search_path = sgc, public;

create or replace function sgc.wa_resumen_grupo_v2(p_grupo_jid text, p_periodo text, p_fecha date default current_date)
returns table (
  grupo_jid text, periodo text, fecha date, desde timestamptz, hasta timestamptz,
  resumen text, decisiones jsonb, pendientes jsonb, mensajes_cubiertos integer
)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
  select r.grupo_jid, r.periodo, r.fecha, r.desde, r.hasta, r.resumen, r.decisiones, r.pendientes, r.mensajes_cubiertos
  from sgc.wa_resumenes r
  where sgc.puede_ver_submodulo('tecnologia.wa_grupos')
    and r.grupo_jid = p_grupo_jid and r.periodo = p_periodo and r.fecha = coalesce(p_fecha, current_date)
  limit 1;
$$;
grant execute on function sgc.wa_resumen_grupo_v2(text, text, date) to authenticated, service_role;

commit;
