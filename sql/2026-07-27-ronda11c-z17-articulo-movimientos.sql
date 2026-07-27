-- ============================================================================
-- RONDA 11c · Z17 — Últimos movimientos de un artículo (para el detalle web)
-- ----------------------------------------------------------------------------
-- Alimenta el modal de detalle del artículo (W11): une salidas y entradas del
-- artículo, ordenadas por fecha. SECURITY DEFINER acotado al módulo inventario/admin.
-- Aditivo.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.ultimos_movimientos_articulo(p_articulo_id uuid, p_limit int default 10)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select case when (sgc.is_admin() or sgc.tiene_modulo('inventario'))
    then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'tipo', m.tipo, 'fecha', m.fecha, 'cantidad', m.cantidad,
               'bodega', m.bodega, 'proyecto', m.proyecto)
             order by m.fecha desc, m.created_at desc), '[]'::jsonb)
      from (
        select 'salida'::text as tipo, s.fecha, s.created_at, ds.cantidad,
               b.nombre as bodega, p.nombre as proyecto
        from sgc.detalle_salidas ds
        join sgc.salidas_inventario s on s.id = ds.salida_id
        left join sgc.bodegas b on b.id = s.bodega_id
        left join sgc.proyectos p on p.id = s.proyecto_id
        where ds.articulo_id = p_articulo_id
          and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
        union all
        select 'entrada'::text, e.fecha, e.created_at, de.cantidad,
               b.nombre, null
        from sgc.detalle_entradas de
        join sgc.entradas_inventario e on e.id = de.entrada_id
        left join sgc.bodegas b on b.id = e.bodega_id
        where de.articulo_id = p_articulo_id
        order by fecha desc, created_at desc
        limit greatest(1, least(coalesce(p_limit, 10), 50))
      ) m
    )
    else '[]'::jsonb end;
$function$;
grant execute on function sgc.ultimos_movimientos_articulo(uuid, int) to authenticated, service_role;
