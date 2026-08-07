-- ============================================================================
-- AI10 + AI11 — Stats del conductor por PERIODO (Mi actividad + Perfil).
--       SGC padre. Aditivo. Una sola pasada, server-side, respeta es_prueba.
-- ----------------------------------------------------------------------------
-- Tiles (sketch de Eduardo):
--   Rutas completadas · Conduces realizados · GL (galones) / KM · Reportes
--   (inspecciones AI8) · Multas · Documentos.
-- Periodo: 'mes' (default Mi actividad) | '3m' | '6m' | '1a' | 'total'
--   (default Perfil = 'total'). El caller decide el default.
-- Fuentes:
--   rutas_completadas   ← rutas (estado='completada')
--   conduces_realizados ← salidas_inventario (conductor_id)
--   galones / km        ← registros_combustible (galones, km_recorridos)
--   inspecciones        ← checklists_vehiculo (tipo='inspeccion')  [ex "reporte semanal"]
--   pre_usos            ← checklists_vehiculo (tipo='pre_uso')      [uso de vehículo]
--   multas              ← conductor_multas
--   documentos          ← v_conductor_documentos (licencia/cédula/total)
-- es_prueba: se excluyen filas de prueba salvo admin.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.stats_conductor_periodo(
  p_conductor_id uuid,
  p_periodo      text default 'total'
) returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_desde  date;
  v_admin  boolean := sgc.is_admin();
  v_result jsonb;
begin
  -- Rango: límite inferior según el periodo (null = sin límite).
  v_desde := case lower(coalesce(p_periodo, 'total'))
    when 'mes'   then date_trunc('month', now())::date
    when '3m'    then (now() - interval '3 months')::date
    when '6m'    then (now() - interval '6 months')::date
    when '1a'    then (now() - interval '1 year')::date
    when '1ano'  then (now() - interval '1 year')::date
    when 'ano'   then (now() - interval '1 year')::date
    when 'anio'  then (now() - interval '1 year')::date
    else null
  end;

  select jsonb_build_object(
    'conductor_id', p_conductor_id,
    'periodo',      lower(coalesce(p_periodo, 'total')),
    'desde',        v_desde,

    'rutas_completadas', (
      select count(*)::int from sgc.rutas r
      where r.conductor_id = p_conductor_id
        and r.estado = 'completada'
        and (v_desde is null or r.fecha >= v_desde)
        and ((not coalesce(r.es_prueba, false)) or v_admin)
    ),
    'conduces_realizados', (
      select count(*)::int from sgc.salidas_inventario s
      where s.conductor_id = p_conductor_id
        and (v_desde is null or s.fecha >= v_desde)
        and ((not coalesce(s.es_prueba, false)) or v_admin)
    ),
    'galones', (
      select coalesce(round(sum(rc.galones)::numeric, 2), 0) from sgc.registros_combustible rc
      where rc.conductor_id = p_conductor_id
        and (v_desde is null or rc.fecha >= v_desde)
        and ((not coalesce(rc.es_prueba, false)) or v_admin)
    ),
    'km', (
      select coalesce(sum(rc.km_recorridos), 0)::int from sgc.registros_combustible rc
      where rc.conductor_id = p_conductor_id
        and (v_desde is null or rc.fecha >= v_desde)
        and ((not coalesce(rc.es_prueba, false)) or v_admin)
    ),
    'inspecciones', (
      select count(*)::int from sgc.checklists_vehiculo cv
      where cv.conductor_id = p_conductor_id
        and cv.tipo = 'inspeccion'
        and (v_desde is null or cv.fecha >= v_desde)
        and ((not coalesce(cv.es_prueba, false)) or v_admin)
    ),
    'pre_usos', (
      select count(*)::int from sgc.checklists_vehiculo cv
      where cv.conductor_id = p_conductor_id
        and cv.tipo = 'pre_uso'
        and (v_desde is null or cv.fecha >= v_desde)
        and ((not coalesce(cv.es_prueba, false)) or v_admin)
    ),
    'multas', (
      select count(*)::int from sgc.conductor_multas m
      where m.conductor_id = p_conductor_id
        and (v_desde is null or m.fecha >= v_desde)
        and ((not coalesce(m.es_prueba, false)) or v_admin)
    ),
    'documentos', (
      select jsonb_build_object(
        'tiene_cedula', d.tiene_cedula,
        'tiene_licencia', d.tiene_licencia,
        'total', d.total_documentos
      )
      from sgc.v_conductor_documentos d where d.conductor_id = p_conductor_id
    )
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function sgc.stats_conductor_periodo(uuid, text) to authenticated, service_role;

-- Documentos del conductor (lista para la sección "Documentos" de Mi actividad).
-- Licencia (de conductores) + cualquier documento asociado en sgc.documentos.
create or replace function sgc.conductor_documentos(p_conductor_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select jsonb_build_object(
    'licencia', (
      select jsonb_build_object(
        'tipo', c.licencia_tipo, 'numero', c.licencia_numero,
        'vencimiento', c.licencia_vencimiento
      ) from sgc.conductores c where c.id = p_conductor_id
    ),
    'resumen', (
      select jsonb_build_object(
        'tiene_cedula', d.tiene_cedula, 'tiene_licencia', d.tiene_licencia,
        'total', d.total_documentos
      ) from sgc.v_conductor_documentos d where d.conductor_id = p_conductor_id
    )
  );
$$;
grant execute on function sgc.conductor_documentos(uuid) to authenticated, service_role;
