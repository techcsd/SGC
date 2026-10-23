-- CW1 — Conduces huérfanos: pantalla de solo lectura para Central/admin que lista
-- conduces atascados en "despachado" por mucho tiempo (la entrega nunca llegó al
-- servidor, o un reintento duplicado quedó colgado), con el botón "Anular con
-- motivo" reusando la MISMA regla ya existente de anular_conduce (admin/creador +
-- sin confirmaciones). D2 (CONTEXTO-56 §4): esta migración NO anula nada por sí
-- sola — solo expone la lista y deja el botón listo; ejecutar sobre datos reales
-- de producción requiere el OK explícito de Xaviel (regla 18).
--
--   node scripts/apply-migration.mjs sql/2026-10-23-cw1-conduces-huerfanos.sql --env dev
-- -------------------------------------------------------------------------------------
begin;
set local search_path = sgc, public;

create or replace function sgc.conduces_huerfanos(p_dias_min int default 3)
returns table (
  id uuid, codigo text, created_at timestamptz, dias_atascado int,
  estado text, chofer_nombre text, destino_texto text,
  tiene_confirmaciones boolean, anulable boolean, creado_por_nombre text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    si.id,
    upper(left(si.id::text, 8)) as codigo,
    si.created_at,
    extract(day from now() - si.created_at)::int as dias_atascado,
    si.estado,
    u_chofer.nombre::text as chofer_nombre,
    si.destino_texto,
    exists (
      select 1 from sgc.recepcion_confirmaciones rc
      where rc.entidad_tipo = 'salida' and rc.entidad_id = si.id
    ) as tiene_confirmaciones,
    (not exists (
      select 1 from sgc.recepcion_confirmaciones rc
      where rc.entidad_tipo = 'salida' and rc.entidad_id = si.id
    ) and si.recibido_por is null) as anulable,
    u_creador.nombre::text as creado_por_nombre
  from sgc.salidas_inventario si
  left join sgc.conductores c on c.id = si.conductor_id
  left join sgc.usuarios u_chofer on u_chofer.id = c.usuario_id
  left join sgc.usuarios u_creador on u_creador.id = si.creado_por
  -- CW8 (auditoría) — solo admin: sgc.anular_conduce ya solo deja pasar a
  -- is_admin() (o al creado_por original), así que un flota-elevado no-admin
  -- vería esta lista pero su botón "Anular" siempre fallaría. Si Xaviel decide
  -- que Logística/flota-elevado también debe poder anular huérfanos, ese es un
  -- cambio de permiso en anular_conduce (no en esta lista), a pedido suyo.
  where sgc.is_admin()
    and coalesce(si.es_prueba, false) = false
    and coalesce(si.estado, '') not in ('entregado', 'entregado_incompleto', 'anulado')
    and si.recibido_por is null
    and si.created_at < now() - make_interval(days => greatest(coalesce(p_dias_min, 3), 0))
  order by si.created_at asc;
$function$;
grant execute on function sgc.conduces_huerfanos(int) to authenticated;
comment on function sgc.conduces_huerfanos(int) is 'CW1 — lista de solo lectura para Central: conduces atascados en despachado hace p_dias_min días o más, sin confirmaciones ni recepción. "anulable" refleja la misma condición que exige sgc.anular_conduce.';

commit;
