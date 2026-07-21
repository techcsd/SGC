-- ============================================================================
-- R10 — Reposición: unificar criterio con "Stock crítico" de Reportes
-- ----------------------------------------------------------------------------
-- Problemas (confirmados):
--   1. Comparaba solo contra el stock de UNA bodega, mientras Reportes usa el
--      stock TOTAL global → "en un lado salen y en otro no".
--   2. Sin forma de ver la vista global (todas las bodegas).
--
-- Fix aditivo/retrocompatible: `p_bodega_id` pasa a tener DEFAULT null.
--   - p_bodega_id = null  → GLOBAL: misma fórmula que Reportes (stock total
--     global <= stock_minimo), para que ambas pantallas coincidan.
--   - p_bodega_id = <id>  → por bodega (comportamiento anterior; incluye
--     artículos con stock_minimo > 0 aunque la bodega no tenga cuadre).
--
-- Nota (pendiente jefe): stock_minimo se trata como umbral GLOBAL por artículo.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.reposicion_almacen(p_bodega_id uuid default null)
returns table(articulo_id uuid, nombre text, codigo text, unidad text, minimo numeric, actual numeric, faltante numeric)
language plpgsql
stable
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare v_proy uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid())) then
    raise exception 'No autorizado';
  end if;

  -- ── Vista GLOBAL (Todas las bodegas): misma fórmula que Reportes ──────────
  if p_bodega_id is null then
    return query
      with tot as (
        select s.articulo_id, sum(s.cantidad) as cantidad
        from sgc.stock_por_bodega s
        group by s.articulo_id
      )
      select a.id, a.nombre::text, a.codigo::text, a.unidad::text,
             a.stock_minimo::numeric                                    as minimo,
             coalesce(t.cantidad, 0)                                    as actual,
             greatest(0, a.stock_minimo - coalesce(t.cantidad, 0))      as faltante
      from sgc.articulos a
      left join tot t on t.articulo_id = a.id
      where a.activo
        and coalesce(t.cantidad, 0) <= a.stock_minimo   -- idéntico a Reportes › stock bajo
      order by faltante desc, a.nombre;
    return;
  end if;

  -- ── Vista POR BODEGA (con kit de cuadre si la obra lo tiene) ─────────────
  select proyecto_id into v_proy from sgc.cuadre_obra where bodega_id = p_bodega_id limit 1;

  return query
    with kit_min as (
      select ci.articulo_id, sum(ci.cantidad_total) as min_kit
      from sgc.cuadre_items ci
      where ci.proyecto_id = v_proy and ci.es_min_stock and ci.articulo_id is not null
      group by ci.articulo_id
    )
    select a.id, a.nombre::text, a.codigo::text, a.unidad::text,
           greatest(a.stock_minimo, coalesce(k.min_kit, 0))                                  as minimo,
           coalesce(s.cantidad, 0)                                                            as actual,
           greatest(0, greatest(a.stock_minimo, coalesce(k.min_kit, 0)) - coalesce(s.cantidad, 0)) as faltante
    from sgc.articulos a
    left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    left join kit_min k on k.articulo_id = a.id
    where a.activo
      and greatest(a.stock_minimo, coalesce(k.min_kit, 0)) > 0
      and coalesce(s.cantidad, 0) <= greatest(a.stock_minimo, coalesce(k.min_kit, 0))
    order by faltante desc;
end;
$function$;
grant execute on function sgc.reposicion_almacen(uuid) to authenticated, service_role;
