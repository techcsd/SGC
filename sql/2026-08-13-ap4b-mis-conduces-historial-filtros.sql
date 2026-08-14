-- =============================================================================
-- PROMPT-11 FASE 3 (AP4-app) — Histórico de conduces de la APP con filtros.
-- SGC padre. Extiende sgc.mis_conduces_historial de forma ADITIVA:
--   · nuevos parámetros opcionales (default null) → 100% retrocompatible con la
--     llamada existente de la app (p_desde, p_hasta, p_proyecto_id, p_limite).
--   · nuevas columnas de salida (origen_proyecto_id/nombre, responsable_match) →
--     los clientes viejos las ignoran.
--
-- "Obra origen"  = obra del almacén de salida (bodegas.proyecto_id de s.bodega_id).
-- "Obra destino" = obra receptora (s.proyecto_id) o la obra del almacén destino
--                  (bodegas.proyecto_id de s.destino_almacen_id).
-- "Mi rol"       = p_rol ∈ {emisor|chofer|receptor}: restringe a los conduces donde
--                  el usuario autenticado matchea ESE rol. responsable_match indica
--                  en cuáles roles matcheó (para pintarlo en la UI).
--
-- A diferencia del listado web (AP4/conduces_web_listado, que gatea por módulo y ve
-- TODO), este es el histórico "mío/operativo" (matriz de visibilidad §11) — el mismo
-- que la app ya consume; sólo le agregamos los filtros del apunte AP4.
-- =============================================================================

begin;

-- La firma NUEVA agrega parámetros → sería un overload distinto (4-arg vs 7-arg) y
-- la llamada legacy de 4 args quedaría AMBIGUA. Se elimina el overload viejo; la
-- nueva firma con defaults cubre 1:1 todas las llamadas previas.
drop function if exists sgc.mis_conduces_historial(date, date, uuid, integer);

create or replace function sgc.mis_conduces_historial(
  p_desde        date default null,
  p_hasta        date default null,
  p_proyecto_id  uuid default null,
  p_limite       integer default 200,
  p_obra_origen  uuid default null,
  p_obra_destino uuid default null,
  p_rol          text default null   -- 'emisor' | 'chofer' | 'receptor' | null
)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(row_to_json(t) order by t.fecha desc, t.creado_en desc), '[]'::jsonb)
  from (
    select
      s.id,
      s.fecha,
      s.created_at                as creado_en,
      s.estado,
      sgc.conduce_fase(s.id)      as fase,
      sgc.conduce_tiene_alto_valor(s.id) as alto_valor,
      p.nombre                    as obra,
      s.proyecto_id,
      b.nombre                    as bodega,
      b.proyecto_id               as origen_proyecto_id,
      obo.nombre                  as origen_proyecto,
      dbo.nombre                  as destino_almacen,
      s.ruta_id,
      s.observaciones,
      s.entrega_receptor          as receptor,
      s.entregado_en,
      s.recibido_por is not null  as confirmado,
      s.recibido_en,
      s.firma_pendiente_usuario_id is not null as firma_pendiente,
      s.firma_pendiente_nombre    as firma_pendiente_nombre,
      (
        select array_remove(array[
          case when s.creado_por = auth.uid() then 'emisor' end,
          case when exists (select 1 from sgc.conductores c
                             where c.id = s.conductor_id and c.usuario_id = auth.uid())
               then 'chofer' end,
          case when s.recibido_por = auth.uid() then 'receptor' end
        ], null)
      ) as responsable_match,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'articulo', a.nombre, 'unidad', a.unidad, 'cantidad', d.cantidad,
          'alto_valor', coalesce(a.entrega_en_mano, false))), '[]'::jsonb)
        from sgc.detalle_salidas d
        join sgc.articulos a on a.id = d.articulo_id
        where d.salida_id = s.id
      ) as items
    from sgc.salidas_inventario s
    left join sgc.proyectos p   on p.id   = s.proyecto_id
    left join sgc.bodegas   b   on b.id   = s.bodega_id
    left join sgc.proyectos obo on obo.id = b.proyecto_id
    left join sgc.bodegas   dbo on dbo.id = s.destino_almacen_id
    where
      -- Matriz de visibilidad (§11): creador/emisor, chofer asignado, flota elevado, inventario.
      (
        s.creado_por = auth.uid()
        or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = auth.uid())
        or sgc.es_flota_elevado()
        or sgc.tiene_modulo('inventario')
        or sgc.is_admin()
      )
      and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
      and (p_desde is null or s.fecha >= p_desde)
      and (p_hasta is null or s.fecha <= p_hasta)
      and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
      and (p_obra_origen is null or b.proyecto_id = p_obra_origen)
      and (p_obra_destino is null
           or s.proyecto_id = p_obra_destino
           or dbo.proyecto_id = p_obra_destino)
      and (p_rol is null
           or (p_rol = 'emisor'   and s.creado_por = auth.uid())
           or (p_rol = 'receptor' and s.recibido_por = auth.uid())
           or (p_rol = 'chofer'   and exists (select 1 from sgc.conductores c
                                              where c.id = s.conductor_id and c.usuario_id = auth.uid())))
    order by s.fecha desc, s.created_at desc
    limit greatest(1, least(p_limite, 500))
  ) t;
$function$;

grant execute on function sgc.mis_conduces_historial(date, date, uuid, integer, uuid, uuid, text)
  to authenticated, service_role;

comment on function sgc.mis_conduces_historial(date, date, uuid, integer, uuid, uuid, text) is
  'AP4-app — histórico operativo de conduces (matriz de visibilidad §11) con filtros combinables: fechas, obra destino (p_proyecto_id legacy o p_obra_destino que cubre almacén destino), obra origen (p_obra_origen) y mi rol (p_rol: emisor|chofer|receptor). Devuelve origen_proyecto + responsable_match (roles en que matchea el usuario). Aditivo/retrocompatible con la firma de 4 args.';

commit;
