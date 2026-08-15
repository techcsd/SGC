-- =============================================================================
-- AR3 — Limpieza del selector de ubicación (almacén): entradas sucias "· Central"
--
-- Raíz (diagnóstico): el selector de Tecnología cargaba TODAS las bodegas con
-- BodegasService.getAll() (sin filtrar activo/es_prueba) y el template pegaba
-- "· Central" a toda bodega con proyecto_id null. En prod existen 8 bodegas
-- SUELTAS duplicadas (proyecto_id null, no principales) con nombres cortos de obra
-- —911, City Place, Inter Plaza, Monterezzo, Olea, Poseidonia, Romo, Volare— que
-- sombrean a su "Almacén X" real de obra. La única central legítima es
-- "Bodega Central" (es_principal=true).
--
-- Fix: (1) re-mapear las referencias guardadas sobre las sueltas a su almacén de
-- obra real; (2) desactivar las 8 sueltas duplicadas (se conserva Bodega Central);
-- (3) RPC homologada ubicaciones_almacen() como fuente ÚNICA de ubicaciones
-- seleccionables (almacenes de obra + centrales reales, sin duplicados ni sufijos
-- crudos, sin es_prueba). IDs verificados en prod el 2026-08-14.
-- =============================================================================

begin;

-- 1) Re-mapear referencias sucias. En prod sólo la suelta "Romo" tenía datos
--    (entradas 2, conteos 1, stock 4 filas con cantidad 0.00). Se repunta el
--    histórico a "Almacén ASA - Residencial Romo (Cap Cana)" y se borran las
--    filas de stock en cero de la bodega duplicada.
--    Romo (suelta) 7d32536f-9299-4e65-81dc-9ab19be29829
--    → Almacén ASA Romo 65e30b45-2ffa-4e11-8b4f-e8176da00479
update sgc.entradas_inventario
   set bodega_id = '65e30b45-2ffa-4e11-8b4f-e8176da00479'
 where bodega_id = '7d32536f-9299-4e65-81dc-9ab19be29829';

update sgc.conteos_inventario
   set bodega_id = '65e30b45-2ffa-4e11-8b4f-e8176da00479'
 where bodega_id = '7d32536f-9299-4e65-81dc-9ab19be29829';

-- stock: fusiona (suma) hacia el almacén real por si hubiese cantidades; luego
-- elimina las filas duplicadas de la bodega suelta. (PK/unique: articulo_id,bodega_id)
insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad)
select articulo_id, '65e30b45-2ffa-4e11-8b4f-e8176da00479'::uuid, cantidad
  from sgc.stock_por_bodega
 where bodega_id = '7d32536f-9299-4e65-81dc-9ab19be29829'
on conflict (articulo_id, bodega_id)
  do update set cantidad = sgc.stock_por_bodega.cantidad + excluded.cantidad;

delete from sgc.stock_por_bodega
 where bodega_id = '7d32536f-9299-4e65-81dc-9ab19be29829';

-- 2) Desactivar las 8 bodegas SUELTAS duplicadas (se conserva Bodega Central).
update sgc.bodegas
   set activo = false
 where proyecto_id is null
   and es_principal = false
   and id in (
     '9c4e307a-e6f9-4718-83c0-86d020d4db4b', -- 911
     'e28be63c-9c22-4740-848b-cc5c6218db25', -- City Place
     'd09e004b-e26e-4904-84f3-1d11f07fe79a', -- Inter Plaza
     'f370827c-a02c-4504-ba45-cb85e7c870ff', -- Monterezzo
     'de68b353-68a3-43a0-aaf1-34bd9fb77756', -- Olea
     '8f4c1bf3-7f65-41d3-8642-06b508bd5fe9', -- Poseidonia
     '7d32536f-9299-4e65-81dc-9ab19be29829', -- Romo
     '1c352277-38ee-4499-aff1-be91057671d2'  -- Volare
   );

-- 3) Fuente ÚNICA homologada de ubicaciones seleccionables.
--    Centrales primero (Bodega Central), luego almacenes de obra alfabéticos.
--    SECURITY DEFINER + gating por referencia (AN3): sirve para selectores de
--    cualquier módulo y para la app, sin exigir módulo inventario.
create or replace function sgc.ubicaciones_almacen(p_incluir_prueba boolean default false)
returns table (
  id              uuid,
  nombre          text,
  es_central      boolean,
  proyecto_id     uuid,
  proyecto_nombre text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select b.id,
         b.nombre,
         (b.proyecto_id is null) as es_central,
         b.proyecto_id,
         p.nombre as proyecto_nombre
    from sgc.bodegas b
    left join sgc.proyectos p on p.id = b.proyecto_id
   where b.activo
     and (p_incluir_prueba or coalesce(b.es_prueba, false) = false)
   order by (b.proyecto_id is null) desc, b.nombre;
$$;
grant execute on function sgc.ubicaciones_almacen(boolean) to authenticated, service_role;
comment on function sgc.ubicaciones_almacen(boolean) is
  'AR3 — fuente única homologada de ubicaciones de almacén seleccionables (almacenes de obra + centrales reales, activos, sin es_prueba). Reemplaza el uso crudo de bodegas.getAll() en los selectores.';

commit;
