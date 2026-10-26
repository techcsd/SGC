// CY24 Fase A -- smoke transaccional (ROLLBACK) de registrar_publicacion_oc y
// resolver_solicitud_producto.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_proveedor_id uuid;
  v_proyecto_id uuid;
  v_categoria_id integer;
  v_orden_id uuid;
  v_item_id uuid;
  v_articulo_sombra_id uuid;
  v_solicitante_id uuid;
  v_resolutor_id uuid;
  v_solicitud_id uuid;
  v_ok boolean;
  v_resultado jsonb;
begin
  select id into v_proveedor_id from sgc.proveedores limit 1;
  select id into v_proyecto_id from sgc.proyectos limit 1;
  select id into v_categoria_id from sgc.categorias_inventario limit 1;
  select ur.usuario_id into v_solicitante_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select ur.usuario_id into v_resolutor_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where ('compras'=any(r.modulos) or 'admin'=any(r.modulos)) and ur.usuario_id <> v_solicitante_id limit 1;
  if v_proveedor_id is null or v_proyecto_id is null or v_categoria_id is null or v_solicitante_id is null or v_resolutor_id is null then
    raise exception 'FALLO_SETUP: faltan datos de prueba (proveedor/proyecto/categoria/2 usuarios de compras distintos)';
  end if;

  -- ===== registrar_publicacion_oc =====
  insert into sgc.ordenes_compra (numero, proveedor_id, estado, fecha, subtotal, impuesto, total, proyecto_id)
    values ('CY24-SMOKE-1', v_proveedor_id, 'pendiente', current_date, 100, 18, 118, v_proyecto_id)
    returning id into v_orden_id;

  v_ok := sgc.registrar_publicacion_oc(v_orden_id, 'publicada', 'purchase', 'P00099', 118.0, null);
  if not v_ok then raise exception 'FALLO: registrar_publicacion_oc devolvio false'; end if;
  perform 1 from sgc.ordenes_compra where id = v_orden_id and odoo_sync_estado = 'publicada' and odoo_nombre = 'P00099' and odoo_total = 118.0;
  if not found then raise exception 'FALLO: registrar_publicacion_oc no escribio los campos esperados'; end if;
  raise notice 'OK: registrar_publicacion_oc escribe odoo_sync_estado/odoo_nombre/odoo_total';

  -- Un error posterior SI debe poder pisar el estado (conflicto).
  v_ok := sgc.registrar_publicacion_oc(v_orden_id, 'conflicto', null, null, null, 'el total no coincide');
  perform 1 from sgc.ordenes_compra where id = v_orden_id and odoo_sync_estado = 'conflicto' and odoo_sync_error = 'el total no coincide' and odoo_nombre = 'P00099';
  if not found then raise exception 'FALLO: el conflicto no actualizo estado/error, o perdio el nombre ya guardado'; end if;
  raise notice 'OK: registrar_publicacion_oc conserva el snapshot previo y actualiza estado/error';

  -- p_odoo_sync_estado invalido -> rechazado.
  begin
    perform sgc.registrar_publicacion_oc(v_orden_id, 'no_existe');
    raise exception 'FALLO: acepto un odoo_sync_estado invalido';
  exception when others then
    if sqlerrm like '%invalido%' then raise notice 'OK: odoo_sync_estado invalido rechazado'; else raise; end if;
  end;

  -- ===== resolver_solicitud_producto =====
  insert into sgc.orden_compra_items (orden_id, descripcion, cantidad, precio_unitario, total)
    values (v_orden_id, 'Material sin equivalente en Odoo', 5, 10, 50) returning id into v_item_id;
  insert into sgc.odoo_producto_solicitudes (orden_id, orden_item_id, descripcion_libre, busqueda_previa, solicitado_por)
    values (v_orden_id, v_item_id, 'Material sin equivalente en Odoo', 'busque "material" y no aparecio', v_solicitante_id)
    returning id into v_solicitud_id;

  -- El propio solicitante NO puede resolver su solicitud (D-9).
  perform set_config('request.jwt.claims', json_build_object('sub', v_solicitante_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform sgc.resolver_solicitud_producto(v_solicitud_id, 'rechazado', null, 'me resuelvo yo mismo');
    raise exception 'FALLO: el solicitante SI pudo resolver su propia solicitud';
  exception when others then
    if sqlerrm like '%propia solicitud%' then raise notice 'OK: el solicitante no puede resolver lo suyo (D-9)'; else raise; end if;
  end;
  reset role;

  -- Un resolutor DISTINTO si puede -- crea el articulo-sombra y re-vincula la linea.
  insert into sgc.articulos (codigo, nombre, categoria_id, unidad, origen)
    values ('CY24-SMOKE-SOMBRA', 'Material sin equivalente en Odoo', v_categoria_id, 'unidad', 'odoo')
    returning id into v_articulo_sombra_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_resolutor_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_resultado := sgc.resolver_solicitud_producto(v_solicitud_id, 'creado', v_articulo_sombra_id, 'se creo como articulo-sombra, origen odoo');
  reset role;
  if not (v_resultado->>'ok')::boolean then raise exception 'FALLO: un resolutor distinto no pudo resolver: %', v_resultado; end if;

  perform 1 from sgc.odoo_producto_solicitudes where id = v_solicitud_id and estado = 'creado' and articulo_resultante_id = v_articulo_sombra_id and resuelto_por = v_resolutor_id;
  if not found then raise exception 'FALLO: la solicitud no quedo marcada creado/resuelta correctamente'; end if;
  perform 1 from sgc.orden_compra_items where id = v_item_id and articulo_id = v_articulo_sombra_id;
  if not found then raise exception 'FALLO: la linea de OC no se re-vinculo automaticamente al articulo-sombra';
  end if;
  raise notice 'OK: resolver_solicitud_producto crea/re-vincula correctamente, con un resolutor distinto al solicitante';

  -- Resolver una solicitud YA resuelta -> no revienta, devuelve ok=false con motivo.
  v_resultado := sgc.resolver_solicitud_producto(v_solicitud_id, 'rechazado', null, 'intento tardio');
  if (v_resultado->>'ok')::boolean then raise exception 'FALLO: resolvio una solicitud que ya estaba resuelta'; end if;
  raise notice 'OK: resolver una solicitud ya resuelta no revienta, informa que ya estaba resuelta';

  -- articulos.origen por defecto sigue siendo sgc (no rompe el flujo normal).
  perform 1 from sgc.articulos where id = v_articulo_sombra_id and origen = 'odoo';
  if not found then raise exception 'FALLO: el articulo-sombra no quedo con origen=odoo'; end if;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY24 Fase A: registrar_publicacion_oc + resolver_solicitud_producto (D-9, re-vinculo, idempotencia de resolucion) verificados (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY24 Fase A smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
