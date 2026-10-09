-- 2026-10-08-ck2-chofer-privado-detalle.sql
-- CK1/CK2 — ficha (detalle) del chofer privado: historial de usos (tomó/soltó/recibió),
-- entregas con fotos, echadas de combustible, inspecciones y vigencias, en un solo jsonb.
-- Solo lectura, DEFINER (salta la RLS que ocultaría datos de otros al que consulta),
-- gate is_admin/es_flota_elevado (misma puerta que listar_choferes_privados, cj12).
-- Aditivo.  node scripts/apply-migration.mjs sql/2026-10-08-ck2-chofer-privado-detalle.sql --env dev

begin;

create or replace function sgc.chofer_privado_detalle(p_usuario_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_json jsonb;
  v_cond_ids uuid[];
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_usuario_id is null then
    raise exception 'Falta el usuario.' using errcode = '22023';
  end if;

  -- El combustible y los checklists enlazan por conductores.id (no usuario_id).
  select array_agg(id) into v_cond_ids from sgc.conductores where usuario_id = p_usuario_id;

  select jsonb_build_object(
    'chofer', (
      select jsonb_build_object(
        'usuario_id', u.id,
        'nombre', u.nombre,
        'cedula', coalesce(c.cedula, u.cedula),
        'telefono', coalesce(c.telefono, u.telefono)
      )
      from sgc.usuarios u
      left join sgc.conductores c on c.usuario_id = u.id
      where u.id = p_usuario_id
      limit 1
    ),
    'vigencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'autorizacion_id', a.id, 'vehiculo_id', a.vehiculo_id,
        'placa', v.placa, 'marca', v.marca, 'modelo', v.modelo,
        'desde', a.desde, 'hasta', a.hasta, 'activa', a.activa,
        'vigente', (a.activa and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date))
      ) order by a.activa desc, a.desde desc)
      from sgc.vehiculo_autorizaciones a
      join sgc.vehiculos v on v.id = a.vehiculo_id
      where a.usuario_id = p_usuario_id
    ), '[]'::jsonb),
    'usos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vu.id, 'vehiculo_id', vu.vehiculo_id, 'placa', v.placa,
        'marca', v.marca, 'modelo', v.modelo,
        'inicio_at', vu.inicio_at, 'fin_at', vu.fin_at,
        'km_inicio', vu.km_inicio, 'km_fin', vu.km_fin,
        'recibido_de', (select ru.nombre from sgc.usuarios ru where ru.id = vu.recibido_de),
        'activa', (vu.fin_at is null)
      ) order by vu.inicio_at desc)
      from sgc.vehiculo_usos vu
      join sgc.vehiculos v on v.id = vu.vehiculo_id
      where vu.usuario_id = p_usuario_id
    ), '[]'::jsonb),
    'entregas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'vehiculo_id', e.vehiculo_id, 'placa', v.placa,
        'tipo', e.tipo, 'estado', e.estado, 'km', e.km,
        'tiene_danos', e.tiene_danos, 'observacion', e.observacion,
        'capturado_en', e.capturado_en,
        'fotos', coalesce((select jsonb_agg(f.storage_path order by f.slot)
                           from sgc.vehiculo_entrega_fotos f where f.entrega_id = e.id), '[]'::jsonb)
      ) order by e.capturado_en desc)
      from sgc.vehiculo_entregas e
      join sgc.vehiculos v on v.id = e.vehiculo_id
      where e.conductor_usuario_id = p_usuario_id
    ), '[]'::jsonb),
    'echadas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rc.id, 'fecha', rc.fecha, 'vehiculo_id', rc.vehiculo_id, 'placa', v.placa,
        'galones', rc.galones, 'monto', rc.monto, 'kilometraje', rc.kilometraje,
        'foto_recibo_path', rc.foto_recibo_path, 'foto_tablero_path', rc.foto_tablero_path,
        'foto_origen', rc.foto_origen
      ) order by rc.fecha desc)
      from sgc.registros_combustible rc
      join sgc.vehiculos v on v.id = rc.vehiculo_id
      where v_cond_ids is not null and rc.conductor_id = any(v_cond_ids)
    ), '[]'::jsonb),
    'inspecciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ch.id, 'fecha', ch.fecha, 'tipo', ch.tipo,
        'vehiculo_id', ch.vehiculo_id, 'placa', v.placa,
        'kilometraje', ch.kilometraje, 'tiene_criticos', ch.tiene_criticos, 'atendido', ch.atendido
      ) order by ch.fecha desc)
      from sgc.checklists_vehiculo ch
      join sgc.vehiculos v on v.id = ch.vehiculo_id
      where v_cond_ids is not null and ch.conductor_id = any(v_cond_ids)
    ), '[]'::jsonb)
  ) into v_json;

  return v_json;
end;
$function$;

grant execute on function sgc.chofer_privado_detalle(uuid) to authenticated, service_role;

commit;
