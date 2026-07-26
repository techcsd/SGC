-- ============================================================================
-- PROMPT-21 · Y4 (cierre lado app) — 2026-07-24
-- `mis_rutas_hoy()` expone los tiempos reales de la ruta para que la app pueda
-- mostrar el contador en vivo y "real vs estimado" (la web ya los lee del detalle).
-- Aditivo/idempotente: solo agrega campos al jsonb; consumidores viejos los ignoran.
-- Depende de sql/2026-07-24-y4-rutas-tiempos-reales.sql (columnas iniciada_at /
-- finalizada_at + tiempo_estimado_min ya existentes).
-- ============================================================================
set search_path = sgc, public;

create or replace function sgc.mis_rutas_hoy()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'origen', r.origen, 'destino', r.destino,
    'estado', r.estado, 'fecha', r.fecha, 'notas', r.notas,
    -- Y4 — tiempos reales de la ruta (aditivos).
    'iniciada_at', r.iniciada_at,
    'finalizada_at', r.finalizada_at,
    'tiempo_estimado_min', r.tiempo_estimado_min
  ) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  where r.fecha = current_date
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$function$;

grant execute on function sgc.mis_rutas_hoy() to authenticated, service_role;
