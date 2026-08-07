-- =============================================================================
-- PROMPT-9 FASE 3 (AH9) — Selector canónico obra↔almacén para Transporte.
-- Aditivo. Contrato único que consumirán TODOS los selectores de destino de la
-- app (PROMPT-10 FASE 3): crear ruta, generar conduce, sacar/entregar material.
--
-- Regla de oro (AH9): el chofer elige la OBRA (destino real); su almacén va
-- implícito y se resuelve server-side. Los almacenes NO ligados a obra
-- (ej. Bodega Central) salen como opciones aparte (tipo='almacen'). Filtra
-- es_prueba server-side (AH11): un no-admin nunca ve obras/almacenes de prueba.
--
-- Modelo obra↔almacén (Z14/AF24): ya explícito — `bodegas.proyecto_id` liga la
-- bodega a su obra (verificado: 11 obras → 1 bodega c/u; 9 bodegas sueltas).
--
-- Contrato de salida (una fila por opción de destino):
--   tipo         'obra' | 'almacen'
--   id           id de la obra (proyecto) | id de la bodega suelta  (id del select)
--   nombre       etiqueta a mostrar
--   proyecto_id  = id si tipo='obra'; null si 'almacen'
--   bodega_id    almacén implícito de la obra (resuelto) | id de la bodega suelta
--   tiene_bodega la obra tiene almacén ligado (para flujos de inventario)
--   latitud/longitud  coords para mapa/ruta (de la obra o de la bodega)
-- =============================================================================

begin;

create or replace function sgc.destinos_transporte()
returns table (
  tipo text,
  id uuid,
  nombre text,
  proyecto_id uuid,
  bodega_id uuid,
  tiene_bodega boolean,
  latitud numeric,
  longitud numeric
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  -- Autorización: cualquier rol operativo de transporte/inventario ve destinos.
  with perm as (
    select (sgc.is_admin()
            or sgc.tiene_modulo('transporte')
            or sgc.tiene_modulo('flota')
            or sgc.tiene_modulo('inventario')
            or sgc.tiene_modulo('compras')
            or exists (select 1 from sgc.conductores c where c.usuario_id = auth.uid())
           ) as ok
  ),
  obra_bodega as (
    -- una bodega por obra (la principal si hay varias); resuelve el almacén implícito
    select distinct on (b.proyecto_id)
           b.proyecto_id, b.id as bodega_id
    from sgc.bodegas b
    where b.proyecto_id is not null and coalesce(b.activo, true)
    order by b.proyecto_id, coalesce(b.es_principal, false) desc, b.created_at asc nulls last
  )
  -- Obras (destino real; almacén implícito resuelto).
  select 'obra'::text as tipo,
         p.id, p.nombre, p.id as proyecto_id,
         ob.bodega_id,
         (ob.bodega_id is not null) as tiene_bodega,
         p.latitud, p.longitud
  from sgc.proyectos p
  cross join perm
  left join obra_bodega ob on ob.proyecto_id = p.id
  where perm.ok
    and coalesce(p.activo, true)
    and (sgc.is_admin() or not coalesce(p.es_prueba, false))  -- AH11

  union all

  -- Almacenes NO ligados a obra (ej. Bodega Central) como opciones aparte.
  select 'almacen'::text as tipo,
         b.id, b.nombre, null::uuid as proyecto_id,
         b.id as bodega_id,
         true as tiene_bodega,
         b.latitud, b.longitud
  from sgc.bodegas b
  cross join perm
  where perm.ok
    and b.proyecto_id is null
    and coalesce(b.activo, true)
    and (sgc.is_admin() or not coalesce(b.es_prueba, false))  -- AH11

  order by tipo, nombre;
$function$;

grant execute on function sgc.destinos_transporte() to authenticated;

commit;
