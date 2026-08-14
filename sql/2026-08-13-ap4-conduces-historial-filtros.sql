-- =============================================================================
-- PROMPT-11 FASE 3 (AP4) — Histórico de conduces: filtros por obra (origen o
-- destino), responsable (emisor/chofer/receptor) y rango de fechas. SGC padre.
--
-- Extiende conduces_web_listado (AO5) de forma aditiva: nuevos parámetros opcionales
-- (todos default null → 100% retrocompatible) + columnas de obra-origen y
-- responsable_match (en qué rol matcheó la persona). El bucket/fase se mantiene.
--
-- "Obra origen"  = obra del almacén de salida (bodegas.proyecto_id de s.bodega_id).
-- "Obra destino" = obra receptora (s.proyecto_id) o la obra del almacén destino
--                  (bodegas.proyecto_id de s.destino_almacen_id).
-- "Responsable"  = persona que matchee emisor(creado_por) / chofer(conductor→usuario)
--                  / receptor(recibido_por); responsable_match indica cuáles.
-- =============================================================================

begin;

drop function if exists sgc.conduces_web_listado();
drop function if exists sgc.conduces_web_listado(uuid, uuid, uuid, date, date, text);

create function sgc.conduces_web_listado(
  p_obra_origen  uuid default null,
  p_obra_destino uuid default null,
  p_responsable  uuid default null,
  p_desde        date default null,
  p_hasta        date default null,
  p_busqueda     text default null
)
returns table (
  id                 uuid,
  fecha              date,
  estado             text,
  fase               text,
  bucket             text,
  proyecto_id        uuid,
  proyecto           text,
  origen_proyecto_id uuid,
  origen_proyecto    text,
  bodega             text,
  destino_almacen    text,
  conductor_id       uuid,
  conductor          text,
  emisor_id          uuid,
  chofer_usuario_id  uuid,
  receptor_id        uuid,
  responsable        text,
  responsable_match  text[],
  items              int,
  es_prueba          boolean,
  created_at         timestamptz
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    s.id,
    s.fecha,
    s.estado::text,
    f.fase,
    case f.fase
      when 'confirmado'      then 'historico'
      when 'entregado'       then 'por_confirmar'
      when 'pendiente_firma' then 'por_confirmar'
      else 'pendientes_entrega'
    end as bucket,
    s.proyecto_id,
    pr.nombre  as proyecto,
    bo.proyecto_id as origen_proyecto_id,
    obo.nombre as origen_proyecto,
    bo.nombre  as bodega,
    dbo.nombre as destino_almacen,
    s.conductor_id,
    co.nombre  as conductor,
    s.creado_por  as emisor_id,
    co.usuario_id as chofer_usuario_id,
    s.recibido_por as receptor_id,
    s.responsable,
    (
      select array_remove(array[
        case when s.creado_por = p_responsable then 'emisor' end,
        case when co.usuario_id = p_responsable then 'chofer' end,
        case when s.recibido_por = p_responsable then 'receptor' end
      ], null)
    ) as responsable_match,
    (select count(*)::int from sgc.detalle_salidas d where d.salida_id = s.id) as items,
    s.es_prueba,
    s.created_at
  from sgc.salidas_inventario s
  cross join lateral (select sgc.conduce_fase(s.id) as fase) f
  left join sgc.proyectos   pr  on pr.id  = s.proyecto_id
  left join sgc.bodegas     bo  on bo.id  = s.bodega_id
  left join sgc.proyectos   obo on obo.id = bo.proyecto_id
  left join sgc.bodegas     dbo on dbo.id = s.destino_almacen_id
  left join sgc.conductores co  on co.id  = s.conductor_id
  where (sgc.is_admin()
     or sgc.tiene_modulo('flota')
     or sgc.tiene_modulo('inventario')
     or sgc.puede_ver_submodulo('inventario.salidas'))
    and (p_obra_origen is null or bo.proyecto_id = p_obra_origen)
    and (p_obra_destino is null
         or s.proyecto_id = p_obra_destino
         or dbo.proyecto_id = p_obra_destino)
    and (p_responsable is null
         or s.creado_por = p_responsable
         or co.usuario_id = p_responsable
         or s.recibido_por = p_responsable)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
    and (p_busqueda is null or p_busqueda = ''
         or pr.nombre ilike '%' || p_busqueda || '%'
         or bo.nombre ilike '%' || p_busqueda || '%'
         or co.nombre ilike '%' || p_busqueda || '%'
         or s.responsable ilike '%' || p_busqueda || '%'
         or ('CND-' || upper(substr(s.id::text, 1, 8))) ilike '%' || upper(p_busqueda) || '%')
  order by s.created_at desc;
$function$;

grant execute on function sgc.conduces_web_listado(uuid, uuid, uuid, date, date, text) to authenticated, service_role;

comment on function sgc.conduces_web_listado(uuid, uuid, uuid, date, date, text) is
  'AO5/AP4: listado web de conduces con fase + bucket + filtros combinables (obra origen, obra destino, responsable con responsable_match, rango de fechas, búsqueda). Todos los parámetros opcionales (retrocompatible con la llamada sin args).';

commit;
