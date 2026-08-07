-- =============================================================================
-- PROMPT-9 FASE 5 (AH15) — Compras por proyecto. Aditivo.
--
-- Vínculo compra↔obra (ya existente, verificado):
--   • ordenes_compra.proyecto_id
--   • entradas_inventario (compra de ferretería AF12): origen_tipo='compra' +
--     origen_proyecto_id = la obra destino.
--
-- RPC canónico para el detalle del proyecto (web) y la vista de consulta de la
-- app (PROMPT-10 FASE 5). Filtra por período opcional, resuelve proveedor y total,
-- respeta es_prueba (AH11) y permisos (admin / módulos proyectos|compras /
-- responsable de la obra / gerente de producción vía membresía AG12/AG16).
--
-- Contrato de salida (una fila por compra):
--   tipo        'orden_compra' | 'ferreteria'
--   id          id de la orden | id de la entrada
--   fecha       date
--   proveedor   nombre (o null)
--   total       numeric (OC: total; ferretería: sum(cantidad*precio_unit))
--   estado      estado de la OC | 'pendiente'|'confirmada' (ferretería)
--   referencia  numero de OC | referencia de la entrada
-- =============================================================================

begin;

create or replace function sgc.compras_de_proyecto(
  p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns table (
  tipo text,
  id uuid,
  fecha date,
  proveedor text,
  total numeric,
  estado text,
  referencia text
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with perm as (
    select (
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos')
      or sgc.tiene_modulo('compras')
      or sgc.tiene_modulo('obra')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (
        select 1 from sgc.proyecto_empleados pe
        join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid())
    ) as ok
  ),
  es_admin as (select sgc.is_admin() as v)
  -- Órdenes de compra ligadas a la obra.
  select 'orden_compra'::text as tipo,
         oc.id,
         oc.fecha,
         pr.nombre as proveedor,
         oc.total,
         oc.estado,
         oc.numero as referencia
  from sgc.ordenes_compra oc
  cross join perm cross join es_admin
  left join sgc.proveedores pr on pr.id = oc.proveedor_id
  where perm.ok
    and oc.proyecto_id = p_proyecto_id
    and (es_admin.v or not coalesce(oc.es_prueba, false))
    and (p_desde is null or oc.fecha >= p_desde)
    and (p_hasta is null or oc.fecha <= p_hasta)

  union all

  -- Compras de ferretería (entradas de inventario tipo compra ligadas a la obra).
  select 'ferreteria'::text as tipo,
         e.id,
         e.fecha,
         pr.nombre as proveedor,
         (select sum(coalesce(de.cantidad,0) * coalesce(de.precio_unit,0))
            from sgc.detalle_entradas de where de.entrada_id = e.id) as total,
         case when coalesce(e.pendiente_confirmacion, false) then 'pendiente' else 'confirmada' end as estado,
         e.referencia
  from sgc.entradas_inventario e
  cross join perm cross join es_admin
  left join sgc.proveedores pr on pr.id = e.proveedor_id
  where perm.ok
    and e.origen_tipo = 'compra'
    and e.origen_proyecto_id = p_proyecto_id
    and (es_admin.v or not coalesce(e.es_prueba, false))
    and (p_desde is null or e.fecha >= p_desde)
    and (p_hasta is null or e.fecha <= p_hasta)

  order by fecha desc nulls last;
$function$;

grant execute on function sgc.compras_de_proyecto(uuid, date, date) to authenticated;

commit;
