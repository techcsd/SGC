-- ============================================================================
-- F6 (ronda DF) — soporte de datos para las animaciones del flujo (DF4/DF5).
-- Aditivo, fechado, idempotente, SOLO agregación de lectura — no toca datos de
-- negocio.
-- ============================================================================
begin;

-- ── Costo total de IA de los 6 agentes hoy, vs el tope diario (DF4-extra —
-- "contador de IA del día" en Tecnología › Agentes). Reusa sgc.uso_ia y
-- sgc.parametros que F3 ya dejó, no duplica ninguna columna. ──
create or replace function sgc.agentes_costo_hoy_total()
returns table (costo_hoy numeric, tope_diario numeric)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select
    coalesce((
      select sum(costo_estimado) from sgc.uso_ia
      where funcion like 'agente_%'
        and created_at::date = (now() at time zone 'America/Santo_Domingo')::date
    ), 0) as costo_hoy,
    coalesce((select valor::numeric from sgc.parametros where clave = 'agente_costo_tope_diario_usd'), 5)
      * 6 as tope_diario;
$function$;
grant execute on function sgc.agentes_costo_hoy_total() to authenticated, service_role;

commit;
