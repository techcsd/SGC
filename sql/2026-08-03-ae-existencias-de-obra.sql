-- ============================================================================
-- AE — Stock disponible en el almacén de una OBRA (para el preview de la devolución
-- en el móvil: avisar si el chofer intenta devolver más de lo que hay en la obra).
-- Devuelve { articulo_id: cantidad } del almacén principal de la obra. Read-only.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.existencias_de_obra(p_proyecto_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'sgc','pg_temp'
as $$
  select coalesce(jsonb_object_agg(s.articulo_id::text, s.cantidad), '{}'::jsonb)
  from sgc.stock_por_bodega s
  where s.bodega_id = (
    select id from sgc.bodegas
    where proyecto_id = p_proyecto_id and coalesce(activo, true)
    order by coalesce(es_principal, false) desc, created_at asc
    limit 1
  )
  and coalesce(s.cantidad, 0) <> 0;
$$;
grant execute on function sgc.existencias_de_obra(uuid) to authenticated, service_role;
