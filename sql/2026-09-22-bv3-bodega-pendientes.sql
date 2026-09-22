-- BV3 — "Pendientes del almacén": lo accionable de una bodega en un solo lugar.
--   · entradas por confirmar (material que llegó — incluye las del conduce externo BV6,
--     que ahora nacen pendientes) → el encargado las recibe.
--   · salidas despachadas desde aquí aún sin confirmar en destino → seguimiento.
-- Solo lectura; se pinta como sección en la página de inventario del almacén.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv3-bodega-pendientes.sql --env dev  →  --env prod
begin;

create or replace function sgc.bodega_pendientes(p_bodega_id uuid)
 returns table(tipo text, id uuid, fecha date, referencia text, renglones integer, dias integer)
 language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  -- Entradas que esperan confirmación de recepción en este almacén.
  select 'entrada'::text as tipo, e.id, e.fecha,
         coalesce(nullif(btrim(e.referencia),''), 'Entrada') as referencia,
         coalesce(jsonb_array_length(e.items_propuestos), 0) as renglones,
         (current_date - e.fecha)::int as dias
  from sgc.entradas_inventario e
  where e.bodega_id = p_bodega_id
    and coalesce(e.pendiente_confirmacion, false) = true
    and coalesce(e.rechazada, false) = false
    and coalesce(e.es_prueba, false) = false
  union all
  -- Salidas despachadas desde este almacén, aún sin confirmar recepción en destino.
  select 'salida'::text as tipo, s.id, s.fecha,
         coalesce(nullif(btrim(s.motivo),''), 'Salida') as referencia,
         ( (select count(*) from sgc.detalle_salidas ds where ds.salida_id = s.id)
         + (select count(*) from sgc.salida_items_libres li where li.salida_id = s.id) )::int as renglones,
         (current_date - s.fecha)::int as dias
  from sgc.salidas_inventario s
  where s.bodega_id = p_bodega_id
    and s.recibido_por is null
    and s.anulado_por is null
    and coalesce(s.estado,'') <> 'anulado'
    and coalesce(s.es_prueba, false) = false
  order by dias desc, fecha asc;
$function$;

grant execute on function sgc.bodega_pendientes(uuid) to authenticated, service_role;

commit;
