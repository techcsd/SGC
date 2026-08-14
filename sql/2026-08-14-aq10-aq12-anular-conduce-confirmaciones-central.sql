-- AQ10 — Eliminar (anular) conduces con reglas server-side + AQ12 — Bodega Central en confirmaciones
--
-- AQ10 (decisiones de Xaviel):
--   • Estados eliminables: SOLO pendientes (no entregado / no confirmado).
--   • Quién: el emisor (creado_por) mientras siga pendiente, o un admin.
--   • Soft-delete (estado='anulado') + auditoría (quién/cuándo/motivo).
--   • Revierte efectos: repone stock si la creación lo descontó; cancela/omite la ruta vinculada.
--   • Desaparece de todos los listados; queda en sgc.auditoria para admin.
--
-- AQ12: los filtros/listas de confirmaciones incluyen la Bodega Central (destino_almacen_id),
--   con equivalencia obra↔almacén consistente (destino = coalesce(obra, almacén destino)).
--
-- Aditivo/retrocompatible.

-- ── AQ10.A) Estado 'anulado' + columnas de auditoría de anulación ─────────────
alter table sgc.salidas_inventario drop constraint if exists salidas_inventario_estado_check;
alter table sgc.salidas_inventario add constraint salidas_inventario_estado_check
  check (estado in ('despachado','entregado','entregado_incompleto','anulado'));

alter table sgc.salidas_inventario
  add column if not exists anulado_por      uuid references sgc.usuarios(id),
  add column if not exists anulado_en       timestamptz,
  add column if not exists motivo_anulacion text;

-- ── AQ10.B) RPC anular_conduce: soft-delete con reglas + reversión + auditoría ──
create or replace function sgc.anular_conduce(p_salida_id uuid, p_motivo text default null)
returns void
language plpgsql security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_s       sgc.salidas_inventario%rowtype;
  v_es_admin boolean := sgc.is_admin();
  r         record;
  v_otras   int;
  v_chofer_usuario uuid;
begin
  select * into v_s from sgc.salidas_inventario where id = p_salida_id;
  if not found then
    raise exception 'Conduce no encontrado.' using errcode = 'P0002';
  end if;

  -- Autorización: emisor (mientras pendiente) o admin.
  if not (v_es_admin or v_s.creado_por = auth.uid()) then
    raise exception 'No tienes permiso para eliminar este conduce.' using errcode = '42501';
  end if;

  -- Solo pendientes: ni entregado, ni confirmado, ni ya anulado.
  if v_s.recibido_por is not null
     or coalesce(v_s.estado,'') in ('entregado','entregado_incompleto','anulado')
     or exists (select 1 from sgc.recepcion_confirmaciones rc
                where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = v_s.id)
  then
    raise exception 'Este conduce ya no puede eliminarse (ya fue entregado o confirmado).'
      using errcode = 'P0001';
  end if;

  -- Reponer stock: la creación descuenta el origen vía trigger de detalle_salidas
  -- (solo cuando NO es prueba). Como es soft-delete, el trigger DELETE no dispara → se repone aquí.
  if not coalesce(v_s.es_prueba, false) then
    for r in select articulo_id, cantidad from sgc.detalle_salidas where salida_id = v_s.id loop
      perform sgc.adjust_stock(r.articulo_id, v_s.bodega_id, r.cantidad);
    end loop;
  end if;

  -- Ruta vinculada: si este conduce es la única parada activa, se cancela la ruta;
  -- si hay otras, solo se omite esta parada (rutas multi-parada).
  if v_s.ruta_id is not null then
    select count(*) into v_otras
    from sgc.salidas_inventario o
    where o.ruta_id = v_s.ruta_id and o.id <> v_s.id and coalesce(o.estado,'') <> 'anulado';
    if coalesce(v_otras,0) = 0 then
      update sgc.rutas set estado = 'cancelada'
        where id = v_s.ruta_id and estado in ('planificada','en_curso');
    end if;
    if v_s.ruta_parada_id is not null then
      update sgc.ruta_paradas set estado = 'omitida'
        where id = v_s.ruta_parada_id and coalesce(estado,'') <> 'entregada';
    end if;
  end if;

  -- Soft-delete + auditoría en columnas propias.
  update sgc.salidas_inventario
     set estado           = 'anulado',
         anulado_por      = auth.uid(),
         anulado_en       = now(),
         motivo_anulacion = nullif(p_motivo, '')
   where id = v_s.id;

  -- Auditoría central (para admin).
  insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios, datos_antes, datos_despues)
  values ('salidas_inventario', v_s.id::text, 'DELETE', auth.uid(),
          jsonb_build_object('accion','anular_conduce','motivo', nullif(p_motivo,'')),
          jsonb_build_object('estado', v_s.estado, 'recibido_por', v_s.recibido_por),
          jsonb_build_object('estado','anulado'));

  -- Avisar al chofer asignado (best-effort; ahora también push por AQ1).
  select usuario_id into v_chofer_usuario from sgc.conductores where id = v_s.conductor_id;
  if v_chofer_usuario is not null then
    perform sgc.notificar(v_chofer_usuario, 'conduce', 'Conduce eliminado',
      'El conduce CND-' || upper(substr(v_s.id::text,1,8)) || ' fue eliminado.', null);
  end if;
end $$;
grant execute on function sgc.anular_conduce(uuid, text) to authenticated, service_role;

-- ── AQ10.C) Los anulados desaparecen del listado web de conduces ──────────────
create or replace function sgc.conduces_web_listado(
  p_obra_origen uuid default null, p_obra_destino uuid default null,
  p_responsable uuid default null, p_desde date default null,
  p_hasta date default null, p_busqueda text default null)
returns table(id uuid, fecha date, estado text, fase text, bucket text, proyecto_id uuid,
  proyecto text, origen_proyecto_id uuid, origen_proyecto text, bodega text, destino_almacen text,
  conductor_id uuid, conductor text, emisor_id uuid, chofer_usuario_id uuid, receptor_id uuid,
  responsable text, responsable_match text[], items integer, es_prueba boolean, created_at timestamptz)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select
    s.id, s.fecha, s.estado::text, f.fase,
    case f.fase
      when 'confirmado'      then 'historico'
      when 'entregado'       then 'por_confirmar'
      when 'pendiente_firma' then 'por_confirmar'
      else 'pendientes_entrega'
    end as bucket,
    s.proyecto_id, pr.nombre as proyecto,
    bo.proyecto_id as origen_proyecto_id, obo.nombre as origen_proyecto,
    bo.nombre as bodega, dbo.nombre as destino_almacen,
    s.conductor_id, co.nombre as conductor,
    s.creado_por as emisor_id, co.usuario_id as chofer_usuario_id, s.recibido_por as receptor_id,
    s.responsable,
    (select array_remove(array[
        case when s.creado_por = p_responsable then 'emisor' end,
        case when co.usuario_id = p_responsable then 'chofer' end,
        case when s.recibido_por = p_responsable then 'receptor' end
      ], null)) as responsable_match,
    (select count(*)::int from sgc.detalle_salidas d where d.salida_id = s.id) as items,
    s.es_prueba, s.created_at
  from sgc.salidas_inventario s
  cross join lateral (select sgc.conduce_fase(s.id) as fase) f
  left join sgc.proyectos   pr  on pr.id  = s.proyecto_id
  left join sgc.bodegas     bo  on bo.id  = s.bodega_id
  left join sgc.proyectos   obo on obo.id = bo.proyecto_id
  left join sgc.bodegas     dbo on dbo.id = s.destino_almacen_id
  left join sgc.conductores co  on co.id  = s.conductor_id
  where (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
         or sgc.puede_ver_submodulo('inventario.salidas'))
    and coalesce(s.estado,'') <> 'anulado'   -- AQ10: los eliminados no aparecen
    and (p_obra_origen is null or bo.proyecto_id = p_obra_origen)
    and (p_obra_destino is null or s.proyecto_id = p_obra_destino or dbo.proyecto_id = p_obra_destino)
    and (p_responsable is null or s.creado_por = p_responsable
         or co.usuario_id = p_responsable or s.recibido_por = p_responsable)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
    and (p_busqueda is null or p_busqueda = ''
         or pr.nombre ilike '%' || p_busqueda || '%'
         or bo.nombre ilike '%' || p_busqueda || '%'
         or co.nombre ilike '%' || p_busqueda || '%'
         or s.responsable ilike '%' || p_busqueda || '%'
         or ('CND-' || upper(substr(s.id::text, 1, 8))) ilike '%' || upper(p_busqueda) || '%')
  order by s.created_at desc;
$$;
grant execute on function sgc.conduces_web_listado(uuid,uuid,uuid,date,date,text) to authenticated, service_role;

-- ── AQ12.D) confirmaciones_historial: destino = obra O Bodega Central ─────────
drop function if exists sgc.confirmaciones_historial(date, date, uuid, text);
create or replace function sgc.confirmaciones_historial(
  p_desde date default null, p_hasta date default null,
  p_proyecto_id uuid default null, p_estado text default null)
returns table(id uuid, fecha date, created_at timestamptz, proyecto_id uuid, proyecto text,
  destino_almacen_id uuid, destino text, bodega text, estado text, fase text,
  entregado_por uuid, entregado_por_nombre text, entregado_en timestamptz,
  recibido_por uuid, recibido_por_nombre text, recibido_en timestamptz,
  tiene_foto boolean, tiene_firma boolean)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select
    s.id, s.fecha, s.created_at,
    s.proyecto_id, p.nombre,
    s.destino_almacen_id, coalesce(p.nombre, ba.nombre) as destino,
    b.nombre,
    s.estado, sgc.conduce_fase(s.id),
    s.entregado_por, ue.nombre, s.entregado_en,
    s.recibido_por, ur.nombre, s.recibido_en,
    (s.recepcion_foto_path is not null),
    exists (select 1 from sgc.salida_firmas sf where sf.salida_id = s.id and sf.rol = 'receptor')
  from sgc.salidas_inventario s
  left join sgc.proyectos p  on p.id  = s.proyecto_id
  left join sgc.bodegas   b  on b.id  = s.bodega_id
  left join sgc.bodegas   ba on ba.id = s.destino_almacen_id
  left join sgc.usuarios ue on ue.id = s.entregado_por
  left join sgc.usuarios ur on ur.id = s.recibido_por
  where s.recibido_por is not null
    and coalesce(s.estado,'') <> 'anulado'
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
    -- AQ12: el filtro de destino aplica a la obra O a la bodega destino (Bodega Central)
    and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id or s.destino_almacen_id = p_proyecto_id)
    and (p_estado is null
         or (p_estado = 'incompleta' and s.estado = 'entregado_incompleto')
         or (p_estado = 'completa'   and s.estado = 'entregado'))
    and (
      sgc.is_admin()
      or exists (select 1 from sgc.usuarios_roles ur2 join sgc.roles r on r.id = ur2.rol_id
                 where ur2.usuario_id = auth.uid()
                   and r.codigo in (select unnest(sgc.param_csv('confirmacion_roles_globales',
                         'admin,direccion,gerencia,gerente_proyectos,jefe_flota,logistica,ingeniero_oficina'))))
      or s.entregado_por = auth.uid()
      or s.creado_por    = auth.uid()
      or s.recibido_por  = auth.uid()
      or exists (select 1 from sgc.proyecto_responsables prr
                 where prr.proyecto_id = s.proyecto_id and prr.usuario_id = auth.uid() and coalesce(prr.activo, true))
    )
  order by s.recibido_en desc nulls last, s.created_at desc
  limit 500;
$$;
grant execute on function sgc.confirmaciones_historial(date,date,uuid,text) to authenticated, service_role;

-- ── AQ12.E) Bandeja "Entregas por confirmar": etiqueta de destino coalescida ──
create or replace function sgc.mis_entregas_por_confirmar()
returns table(id uuid, fecha date, proyecto_id uuid, destino text, bodega text, estado text,
  fase text, entregado_en timestamptz, entrega_foto_path text, created_at timestamptz)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $$
  select s.id, s.fecha, s.proyecto_id,
         coalesce(p.nombre, ba.nombre) as destino, b.nombre, s.estado,
         sgc.conduce_fase(s.id), s.entregado_en, s.entrega_foto_path, s.created_at
  from sgc.salidas_inventario s
  left join sgc.proyectos p  on p.id  = s.proyecto_id
  left join sgc.bodegas   b  on b.id  = s.bodega_id
  left join sgc.bodegas   ba on ba.id = s.destino_almacen_id
  where s.estado in ('entregado','entregado_incompleto')
    and s.recibido_por is null
    and not exists (select 1 from sgc.recepcion_confirmaciones rc
                    where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = s.id)
    and not (sgc.es_chofer_de_conduce(s.id) and not sgc.is_admin())
    and sgc.es_confirmador_de_conduce(s.id)
  order by s.entregado_en desc nulls last, s.created_at desc;
$$;
grant execute on function sgc.mis_entregas_por_confirmar() to authenticated, service_role;
