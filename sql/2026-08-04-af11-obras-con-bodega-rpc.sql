-- AF11-bug — En "sacar material" (salida) el listado de obra/almacén de DESTINO
-- no carga para usuarios de inventario/chofer.
--
-- Causa raíz: el loader `getObrasConBodega` de la app lee sgc.proyectos directo,
-- pero la política `proyectos: select` solo deja ver proyectos a admin, a quien
-- tenga el módulo 'proyectos', al responsable, o a asignados en proyecto_empleados.
-- Un almacenista/chofer tiene el módulo 'inventario' pero NO 'proyectos' → RLS
-- devuelve [] (sin error) → el select de destino queda vacío (y envenena el cache
-- offline). La consulta de bodegas sí pasa (tiene_modulo('inventario')).
--
-- Fix (least-privilege, aditivo): RPC security-definer que devuelve las obras
-- para el selector de destino SIN aflojar la RLS de la tabla base. Gateada al
-- módulo inventario/compras (o admin). Respeta activo y aísla proyectos de prueba
-- (solo admin los ve), consistente con el resto del sistema.

create or replace function sgc.obras_con_bodega()
returns table (id uuid, nombre text, tiene_bodega boolean)
language sql security definer set search_path to 'sgc', 'pg_temp' as $$
  select p.id, p.nombre,
         exists (select 1 from sgc.bodegas b where b.proyecto_id = p.id and b.activo) as tiene_bodega
  from sgc.proyectos p
  where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras'))
    and coalesce(p.activo, true)
    and (sgc.is_admin() or not coalesce(p.es_prueba, false))
  order by p.nombre;
$$;

grant execute on function sgc.obras_con_bodega() to authenticated, service_role;
