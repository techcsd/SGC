-- =============================================================================
-- PROMPT-13 FASE 4 (AJ9, AJ11) — Stats por periodo con "1 semana" + el chofer ve
-- su propio perfil de conductor. Ronda 08/08/2026 (IDs AJ). Aditivo/retrocompat.
-- =============================================================================

begin;

-- ── 1) stats_conductor_periodo: añade 'semana' + gating (el chofer ve lo suyo) ─
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
  -- Gating: admin / flota elevada / el propio chofer dueño del conductor.
  if not (v_admin or sgc.es_flota_elevado()
          or exists (select 1 from sgc.conductores c
                     where c.id = p_conductor_id and c.usuario_id = auth.uid())) then
    raise exception 'No autorizado para ver estas estadísticas.';
  end if;

  -- Rango: límite inferior según el periodo (null = sin límite).
  v_desde := case lower(coalesce(p_periodo, 'total'))
    when 'semana'   then (now() - interval '7 days')::date
    when '1semana'  then (now() - interval '7 days')::date
    when '1s'       then (now() - interval '7 days')::date
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
      where r.conductor_id = p_conductor_id and r.estado = 'completada'
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
      where cv.conductor_id = p_conductor_id and cv.tipo = 'inspeccion'
        and (v_desde is null or cv.fecha >= v_desde)
        and ((not coalesce(cv.es_prueba, false)) or v_admin)
    ),
    'pre_usos', (
      select count(*)::int from sgc.checklists_vehiculo cv
      where cv.conductor_id = p_conductor_id and cv.tipo = 'pre_uso'
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
        'tiene_cedula', d.tiene_cedula, 'tiene_licencia', d.tiene_licencia,
        'total', d.total_documentos)
      from sgc.v_conductor_documentos d where d.conductor_id = p_conductor_id
    )
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function sgc.stats_conductor_periodo(uuid, text) to authenticated, service_role;

-- ── 2) mi_perfil_conductor(): el chofer lee SU propio perfil (solo lectura) ───
-- Resuelve el conductor del usuario autenticado y devuelve datos básicos + el
-- conductor_id para que la app pida stats/documentos. Sin acciones de admin.
create or replace function sgc.mi_perfil_conductor()
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid(); v_c sgc.conductores%rowtype; v_veh jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_c from sgc.conductores
    where usuario_id = v_uid and coalesce(activo, true)
    order by updated_at desc nulls last limit 1;
  if not found then
    return jsonb_build_object('es_conductor', false);
  end if;

  select jsonb_build_object('id', v.id, 'placa', v.placa, 'marca', v.marca, 'modelo', v.modelo)
    into v_veh from sgc.vehiculos v where v.id = v_c.vehiculo_id;

  return jsonb_build_object(
    'es_conductor', true,
    'conductor_id', v_c.id,
    'nombre',       v_c.nombre,
    'cedula',       v_c.cedula,
    'telefono',     v_c.telefono,
    'tags',         to_jsonb(coalesce(v_c.tags, array[]::text[])),
    'nota',         v_c.nota,
    'licencia',     jsonb_build_object(
                      'tipo', v_c.licencia_tipo, 'numero', v_c.licencia_numero,
                      'vencimiento', v_c.licencia_vencimiento),
    'tipo_vehiculo_autorizado', v_c.tipo_vehiculo_autorizado,
    'vehiculo',     v_veh,
    'solo_lectura', true
  );
end;
$$;
grant execute on function sgc.mi_perfil_conductor() to authenticated, service_role;

commit;
