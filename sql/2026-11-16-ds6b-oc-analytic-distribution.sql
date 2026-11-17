-- DS-06 (ronda DS, 16-nov-2026) / issue #51: la OC publicada imputa cada linea a la cuenta analitica de la obra.
-- ADITIVA: ordenes_compra.odoo_analytic_elegida (selector cuando el proyecto tiene >1 cuenta) y el payload de oc_para_publicar
-- ahora trae las cuentas del proyecto, su confirmacion y el entorno de la instancia. El adaptador arma analytic_distribution.
alter table sgc.ordenes_compra add column if not exists odoo_analytic_elegida bigint check (odoo_analytic_elegida is null or odoo_analytic_elegida > 0);
comment on column sgc.ordenes_compra.odoo_analytic_elegida is 'DS-06 cuenta analitica elegida al crear la OC (solo si el proyecto tiene mas de una)';

CREATE OR REPLACE FUNCTION sgc.oc_para_publicar(p_orden_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_oc sgc.ordenes_compra;
  v_proveedor sgc.proveedores;
  v_proyecto sgc.proyectos;
  v_instancia_id uuid;
  v_instancias_habilitadas integer;
  v_lineas jsonb;
  v_lineas_sin_producto integer;
  v_cuentas jsonb;
  v_entorno text;
  v_elegida bigint;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede publicar una orden de compra en Odoo' using errcode = '42501';
  end if;

  select * into v_oc from sgc.ordenes_compra where id = p_orden_id;
  if not found then raise exception 'Orden de compra no encontrada'; end if;

  -- D-16 / E10: una OC de prueba NUNCA se publica, aunque se pida.
  if coalesce(v_oc.es_prueba, false) then
    raise exception 'Una orden de compra de prueba no se publica en Odoo' using errcode = '22023';
  end if;

  select count(*) into v_instancias_habilitadas from sgc.odoo_instancias where habilitada;
  if v_instancias_habilitadas <> 1 then
    raise exception 'No hay una instancia de Odoo habilitada para publicar' using errcode = '22023';
  end if;
  select id into v_instancia_id from sgc.odoo_instancias where habilitada;

  select * into v_proveedor from sgc.proveedores where id = v_oc.proveedor_id;
  -- E9: proveedor sin vinculo a Odoo bloquea la publicacion con mensaje claro.
  if v_proveedor.odoo_id is null then
    raise exception 'El proveedor de esta orden todavía no está vinculado a Odoo (%)', v_proveedor.nombre using errcode = '22023';
  end if;

  -- Issue #51: la OC debe imputar el costo a una obra con cuenta analitica
  -- vinculada. Nunca se adivina por nombre -- si falta, error explicito.
  if v_oc.proyecto_id is null then
    raise exception 'Esta orden de compra no tiene un proyecto/obra asignado; no se puede publicar en Odoo sin saber a qué obra imputar el costo' using errcode = '22023';
  end if;
  select * into v_proyecto from sgc.proyectos where id = v_oc.proyecto_id;
  if v_proyecto.odoo_analytic_id is null then
    raise exception 'El proyecto "%" todavía no está vinculado a una cuenta analítica de Odoo' , v_proyecto.nombre using errcode = '22023';
  end if;

  -- DS-06: cuentas analiticas del proyecto (tabla hija) + la elegida en la OC. El flag de confirmacion lo exige prod.
  select coalesce(jsonb_agg(jsonb_build_object('odoo_analytic_id', a.odoo_analytic_id, 'rol', a.rol, 'confirmado', a.confirmado) order by (a.rol = 'principal') desc, a.odoo_analytic_id), '[]'::jsonb)
    into v_cuentas from sgc.proyecto_odoo_analiticas a where a.proyecto_id = v_oc.proyecto_id and a.odoo_instancia_id = v_instancia_id;
  select entorno into v_entorno from sgc.odoo_instancias where id = v_instancia_id;
  v_elegida := v_oc.odoo_analytic_elegida;

  -- Criterio 6: una línea sin producto Odoo no se puede publicar; se indica cuáles faltan.
  select count(*) into v_lineas_sin_producto
    from sgc.orden_compra_items where orden_id = p_orden_id and odoo_product_id is null;
  if v_lineas_sin_producto > 0 then
    raise exception '% línea(s) de esta orden todavía no tienen producto de Odoo vinculado' , v_lineas_sin_producto using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', oci.id, 'odoo_product_id', oci.odoo_product_id, 'odoo_uom_id', oci.odoo_uom_id,
      'cantidad', oci.cantidad, 'precio_unitario', oci.precio_unitario, 'descripcion', oci.descripcion
    )), '[]'::jsonb)
    into v_lineas
    from sgc.orden_compra_items oci where oci.orden_id = p_orden_id;

  return jsonb_build_object(
    'odoo_instancia_id', v_instancia_id,
    'orden_id', v_oc.id,
    'numero', v_oc.numero,
    'odoo_proveedor_id', v_proveedor.odoo_id,
    'odoo_analytic_id', v_proyecto.odoo_analytic_id,
    'odoo_analytic_confirmado', coalesce(v_proyecto.odoo_analytic_confirmado, false),
    'cuentas_analiticas', v_cuentas,
    'odoo_analytic_elegida', v_elegida,
    'odoo_entorno', v_entorno,
    'fecha', v_oc.fecha,
    'fecha_entrega_esperada', v_oc.fecha_entrega_esperada,
    'notas', v_oc.notas,
    'lineas', v_lineas,
    'odoo_id_existente', v_oc.odoo_id
  );
end;
$function$;
