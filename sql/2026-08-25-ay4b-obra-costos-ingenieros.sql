-- ============================================================================
-- AY4 (cont.) — Ocultar los COSTOS de producción (obra.avance) a los Ingenieros.
-- El rol unificado "Ingenieros" tiene el módulo `obra` (para avance físico, NC,
-- plan del día, etc.), y `costo_material_obra` dejaba pasar a cualquiera con
-- `obra`. Se excluye al rol Ingenieros (código canónico `ingeniero_campo`) SALVO
-- que también sea admin/gerencia/proyectos/dirección. Capataz y gerente de
-- producción (obra, no ingenieros) conservan los costos. Espejo del gate de UI.
-- Solo cambia la línea de autorización; el resto del cuerpo es idéntico a prod.
-- ============================================================================

begin;
set local search_path = sgc, public;

create or replace function sgc.costo_material_obra(p_proyecto_id uuid, p_desde date default null, p_hasta date default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $function$
declare v_result jsonb; v_es_ingeniero boolean;
begin
  v_es_ingeniero := exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo = 'ingeniero_campo'
  );
  if not (
    sgc.is_admin()
    or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('direccion')
    or (sgc.tiene_modulo('obra') and not v_es_ingeniero)   -- ingenieros: sin costos
  ) then
    raise exception 'Sin permiso para ver costos de obra' using errcode = '42501';
  end if;
  select jsonb_build_object('total', coalesce(sum(t.costo), 0),
    'por_articulo', coalesce(jsonb_agg(jsonb_build_object('articulo_id', t.articulo_id, 'nombre', t.nombre, 'unidad', t.unidad,
        'cantidad', t.cantidad, 'costo_unit_prom', t.costo_unit_prom, 'costo', t.costo) order by t.costo desc), '[]'::jsonb)) into v_result
  from (select ds.articulo_id, a.nombre, a.unidad, sum(ds.cantidad) as cantidad,
           round(sum(ds.cantidad * coalesce(ds.costo_unit,0)) / nullif(sum(ds.cantidad),0), 2) as costo_unit_prom,
           sum(ds.cantidad * coalesce(ds.costo_unit,0)) as costo
    from sgc.detalle_salidas ds join sgc.salidas_inventario sa on sa.id = ds.salida_id
    left join sgc.articulos a on a.id = ds.articulo_id
    where sa.proyecto_id = p_proyecto_id and not coalesce(sa.es_prueba, false)
      and (p_desde is null or sa.fecha >= p_desde) and (p_hasta is null or sa.fecha <= p_hasta)
    group by ds.articulo_id, a.nombre, a.unidad) t;
  return v_result;
end; $function$;
grant execute on function sgc.costo_material_obra(uuid, date, date) to authenticated, service_role;

commit;
