-- BV9/BV11 — Requisiciones: fase derivada (pendiente/en_proceso/completada/rechazada)
-- SIN tocar el CHECK de estado, y fecha de necesidad editable por el solicitante.
-- Nota #58 "status: pendientes, en proceso y completadas"; #60 "el ingeniero pueda
-- editar la fecha de necesidad".
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv9-bv11-requisicion-fase-fecha.sql --env dev  →  --env prod
-- Rollback: drop function requisicion_set_fecha_necesidad(uuid,date,text), requisicion_fase(sgc.solicitudes_material), requisicion_fase(uuid);
begin;

-- BV9 — fase derivada por id (para app/correo).
create or replace function sgc.requisicion_fase(p_id uuid)
returns text language sql stable security definer set search_path to 'sgc', 'pg_temp' as $fn$
  -- Mapea los estados REALES (más ricos que el CHECK documentado): completada/
  -- entregada/cerrada→completada; parcial/por_despachar→en_proceso; rechazada/
  -- cancelada→rechazada; aprobada→en_proceso si quedan renglones pendientes.
  select case
    when s.estado in ('rechazada', 'cancelada') then 'rechazada'
    when s.estado in ('completada', 'entregada', 'cerrada') then 'completada'
    when s.estado in ('parcial', 'por_despachar') then 'en_proceso'
    when s.estado = 'aprobada' then
      case when exists (select 1 from sgc.requisicion_pendiente_items(s.id) pi where pi.pendiente > 0)
           then 'en_proceso' else 'completada' end
    else 'pendiente'
  end
  from sgc.solicitudes_material s where s.id = p_id
$fn$;

-- BV9 — misma fase como COLUMNA COMPUTADA (PostgREST): la web la pide como `fase`
-- en el select de solicitudes_material sin N+1 de red.
create or replace function sgc.requisicion_fase(sol sgc.solicitudes_material)
returns text language sql stable security definer set search_path to 'sgc', 'pg_temp' as $fn$
  select sgc.requisicion_fase(sol.id)
$fn$;

-- BV11 — el solicitante (mientras no esté completada/rechazada) o flota-elevado/inventario
-- edita la fecha de necesidad; queda en el historial (BF6) y avisa al aprobador si adelanta.
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values ('requisicion_fecha_cambio', 'Cambio de fecha de necesidad',
        'Aviso cuando se adelanta la fecha de necesidad de una requisición', false,
        array['email', 'in_app', 'push'], true, 120)
on conflict (tipo) do nothing;

create or replace function sgc.requisicion_set_fecha_necesidad(p_id uuid, p_fecha date, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $fn$
declare
  v_uid  uuid := auth.uid();
  v_sol  sgc.solicitudes_material;
  v_fase text;
  v_old  date;
begin
  select * into v_sol from sgc.solicitudes_material where id = p_id;
  if not found then raise exception 'Requisición no encontrada' using errcode = '22023'; end if;

  v_fase := sgc.requisicion_fase(p_id);
  if not (
    (v_sol.solicitante_id = v_uid and v_fase in ('pendiente', 'en_proceso'))
    or sgc.es_flota_elevado()
    or sgc.tiene_modulo('inventario')
  ) then
    raise exception 'No puedes editar la fecha de necesidad de esta requisición' using errcode = '22023';
  end if;

  v_old := v_sol.fecha_necesidad::date;
  update sgc.solicitudes_material set fecha_necesidad = p_fecha where id = p_id;

  insert into sgc.solicitud_material_ediciones (solicitud_id, editado_por, editado_at, cambios)
  values (p_id, v_uid, now(),
          jsonb_build_object('campo', 'fecha_necesidad', 'antes', v_old, 'despues', p_fecha, 'motivo', coalesce(p_motivo, '')));

  -- Aviso al aprobador solo si adelanta (o si antes no tenía fecha).
  if v_old is null or p_fecha < v_old then
    begin
      perform sgc.notificar_modulo('inventario', 'requisicion_fecha_cambio',
        'Fecha de necesidad adelantada',
        'Una requisición ahora se necesita el ' || to_char(p_fecha, 'DD/MM/YYYY') || '.',
        '/inventario/requisiciones', p_id, 'requisicion');
    exception when others then null; -- el aviso nunca bloquea la edición
    end;
  end if;
end $fn$;

grant execute on function sgc.requisicion_fase(uuid) to authenticated, service_role;
grant execute on function sgc.requisicion_fase(sgc.solicitudes_material) to authenticated, anon, service_role;
grant execute on function sgc.requisicion_set_fecha_necesidad(uuid, date, text) to authenticated, service_role;

commit;
