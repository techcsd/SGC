// CY24d -- smoke transaccional (ROLLBACK) de mi_solicitud_compra_odoo_estado.
// Cubre los 2 bugs encontrados en la verificación en vivo desde csd-app
// (cy24e: errcode invalido; cy24f: valores de enum inventados) para que no
// se repitan si alguien vuelve a tocar esta función.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_proveedor_id uuid;
  v_proyecto_id uuid;
  v_solicitante_id uuid;
  v_resolutor_id uuid;
  v_orden_id uuid;
  v_item_id uuid;
  v_solicitud_compra_id uuid;
  v_alta_id uuid;
  v_resultado jsonb;
  v_n int;
begin
  select id into v_proveedor_id from sgc.proveedores limit 1;
  select id into v_proyecto_id from sgc.proyectos limit 1;
  select ur.usuario_id into v_solicitante_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select ur.usuario_id into v_resolutor_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where ('compras'=any(r.modulos) or 'admin'=any(r.modulos)) and ur.usuario_id <> v_solicitante_id limit 1;
  if v_proveedor_id is null or v_proyecto_id is null or v_solicitante_id is null or v_resolutor_id is null then
    raise exception 'FALLO_SETUP: faltan datos de prueba (proveedor/proyecto/2 usuarios de compras distintos)';
  end if;

  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, notas)
    values (v_proyecto_id, v_solicitante_id, 'CY24D-SMOKE') returning id into v_solicitud_compra_id;
  insert into sgc.ordenes_compra (numero, proveedor_id, estado, fecha, subtotal, impuesto, total, proyecto_id)
    values ('CY24D-SMOKE-1', v_proveedor_id, 'pendiente', current_date, 100, 18, 118, v_proyecto_id)
    returning id into v_orden_id;
  update sgc.solicitudes_compra set orden_compra_id = v_orden_id where id = v_solicitud_compra_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_solicitante_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Sin odoo_sync_estado (nunca se intento publicar) -> todo null (CY24-1: igual que hoy).
  v_resultado := sgc.mi_solicitud_compra_odoo_estado(v_solicitud_compra_id);
  if v_resultado->>'odoo_estado' is not null then raise exception 'FALLO: odoo_sync_estado null deberia dar odoo_estado null, dio %', v_resultado; end if;
  raise notice 'OK: sin intento de publicacion -> odoo_estado null (CY24-1)';

  reset role;

  -- Cada valor REAL del CHECK de odoo_sync_estado debe mapear a texto, no a null
  -- (el bug cy24f original solo cubria 'conflicto'/'publicada').
  for v_n in 1..6 loop
    update sgc.ordenes_compra set odoo_sync_estado = (array['pendiente','publicada','confirmada','cancelada','error','conflicto'])[v_n] where id = v_orden_id;
    perform set_config('request.jwt.claims', json_build_object('sub', v_solicitante_id::text, 'role','authenticated')::text, true);
    set local role authenticated;
    v_resultado := sgc.mi_solicitud_compra_odoo_estado(v_solicitud_compra_id);
    reset role;
    if v_resultado->>'odoo_estado' is null then
      raise exception 'FALLO: odoo_sync_estado=% no deberia mapear a null, dio %', (array['pendiente','publicada','confirmada','cancelada','error','conflicto'])[v_n], v_resultado;
    end if;
  end loop;
  raise notice 'OK: los 6 valores reales de odoo_sync_estado mapean a un texto sin jerga (ninguno cae en null)';

  -- Alta de producto pendiente debe GANARLE al semaforo de sync (aunque ya
  -- diga 'publicada', si hay un renglon sin producto resuelto, eso es lo
  -- que realmente bloquea -- E3 de la issue #24).
  update sgc.ordenes_compra set odoo_sync_estado = 'publicada' where id = v_orden_id;
  insert into sgc.orden_compra_items (orden_id, descripcion, cantidad, precio_unitario, total)
    values (v_orden_id, 'Material sin equivalente en Odoo', 5, 10, 50) returning id into v_item_id;
  insert into sgc.odoo_producto_solicitudes (orden_id, orden_item_id, descripcion_libre, busqueda_previa, solicitado_por)
    values (v_orden_id, v_item_id, 'Material sin equivalente en Odoo', 'busque "material" y no aparecio', v_solicitante_id)
    returning id into v_alta_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_solicitante_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_resultado := sgc.mi_solicitud_compra_odoo_estado(v_solicitud_compra_id);
  reset role;
  if v_resultado->>'odoo_estado' <> 'pendiente de producto' then raise exception 'FALLO: una alta pendiente deberia ganarle a odoo_sync_estado=publicada, dio %', v_resultado; end if;
  if v_resultado->>'alta_producto_estado' <> 'pendiente' then raise exception 'FALLO: alta_producto_estado deberia ser pendiente, dio %', v_resultado; end if;
  raise notice 'OK: alta de producto pendiente le gana al semaforo de sync (pendiente de producto)';

  -- Rechazo con motivo -- el bug cy24e comparaba contra 'rechazada' (no existe);
  -- el valor real del CHECK es 'rechazado'.
  perform set_config('request.jwt.claims', json_build_object('sub', v_resolutor_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  perform sgc.resolver_solicitud_producto(v_alta_id, 'rechazado', null, 'no es un producto valido para Odoo');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_solicitante_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_resultado := sgc.mi_solicitud_compra_odoo_estado(v_solicitud_compra_id);
  reset role;
  if v_resultado->>'alta_producto_estado' <> 'rechazada' then raise exception 'FALLO: un rechazo deberia dar alta_producto_estado=rechazada, dio %', v_resultado; end if;
  if v_resultado->>'alta_producto_motivo' <> 'no es un producto valido para Odoo' then raise exception 'FALLO: el motivo del rechazo se perdio, dio %', v_resultado; end if;
  raise notice 'OK: rechazo con motivo se refleja correctamente (bug de enum cy24e/f corregido)';

  -- Ya sin alta pendiente (la unica que habia quedo rechazada), vuelve a
  -- mandar el semaforo de sync.
  if v_resultado->>'odoo_estado' <> 'publicada' then raise exception 'FALLO: sin alta pendiente deberia volver a mostrar el semaforo de sync (publicada), dio %', v_resultado; end if;
  raise notice 'OK: sin alta pendiente, vuelve a mandar odoo_sync_estado';

  -- Otra persona NO puede ver el estado de una solicitud ajena.
  perform set_config('request.jwt.claims', json_build_object('sub', v_resolutor_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform sgc.mi_solicitud_compra_odoo_estado(v_solicitud_compra_id);
    raise exception 'FALLO: otra persona pudo ver una solicitud ajena';
  exception when others then
    if sqlerrm like '%no encontrada%' then raise notice 'OK: una solicitud ajena no es visible'; else raise; end if;
  end;
  reset role;

  -- Sin autenticar.
  perform set_config('request.jwt.claims', '', true);
  reset role;
  begin
    perform sgc.mi_solicitud_compra_odoo_estado(v_solicitud_compra_id);
    raise exception 'FALLO: respondio sin sesion';
  exception when others then
    if sqlerrm like '%No autenticado%' then raise notice 'OK: exige sesion (sin el errcode invalido de cy24e -- P0001 limpio)'; else raise; end if;
  end;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY24d: mi_solicitud_compra_odoo_estado -- 6 valores reales de odoo_sync_estado, prioridad de alta pendiente, enum de rechazo correcto, ajena/sin-sesion rechazadas (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY24d smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
