// CY24 (#24) -- smoke transaccional (ROLLBACK) del flag odoo_compras_piloto_habilitado
// y de vincular_item_producto_odoo (escribe la identidad Odoo de un renglón ya creado).
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_compras_id uuid;
  v_otro_id uuid;
  v_proveedor_id uuid;
  v_orden_id uuid;
  v_item_id uuid;
  v_flag boolean;
  v_ok boolean;
begin
  select ur.usuario_id into v_compras_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select ur.usuario_id into v_otro_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where not('compras'=any(r.modulos) or 'admin'=any(r.modulos)) limit 1;
  select id into v_proveedor_id from sgc.proveedores limit 1;
  if v_compras_id is null or v_proveedor_id is null then raise exception 'FALLO_SETUP: faltan datos de prueba'; end if;

  -- El flag es legible por cualquier autenticado (RPC SECURITY DEFINER) y por defecto está apagado.
  perform set_config('request.jwt.claims', json_build_object('sub', coalesce(v_otro_id, v_compras_id)::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select sgc.odoo_compras_piloto_habilitado() into v_flag;
  if v_flag is distinct from false then raise exception 'FALLO: el flag no nació apagado (criterio 1 de CY24)'; end if;
  raise notice 'OK: odoo_compras_piloto_habilitado() = false por defecto';
  reset role;

  -- Crea una OC real con un renglón para probar vincular_item_producto_odoo.
  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_orden_id := sgc.crear_orden_compra(
    v_proveedor_id, null, 'borrador', current_date, null, 100, 18, 118, 'smoke cy24c', v_compras_id,
    jsonb_build_array(jsonb_build_object('articulo_id', null, 'descripcion', 'renglón de prueba', 'cantidad', 1, 'precio_unitario', 100, 'total', 100)),
    'oficina', true, true
  );
  select id into v_item_id from sgc.orden_compra_items where orden_id = v_orden_id limit 1;
  if v_item_id is null then raise exception 'FALLO_SETUP: no se creó el renglón de prueba'; end if;

  -- Rechaza un id de producto inválido.
  begin
    perform sgc.vincular_item_producto_odoo(v_item_id, 0, null, null);
    raise exception 'FALLO: aceptó un odoo_product_id inválido';
  exception when others then
    if sqlerrm like '%inválido%' then raise notice 'OK: odoo_product_id<=0 se rechaza'; else raise; end if;
  end;

  -- Vincula de verdad, guardando snapshot completo (AT11).
  select sgc.vincular_item_producto_odoo(v_item_id, 4821, 1, jsonb_build_object('id', 4821, 'nombre', 'Cemento gris 42.5kg', 'codigo', 'CEM-001')) into v_ok;
  if not v_ok then raise exception 'FALLO: vincular_item_producto_odoo no reportó éxito'; end if;
  perform 1 from sgc.orden_compra_items where id = v_item_id and odoo_product_id = 4821 and odoo_uom_id = 1 and odoo_snapshot->>'nombre' = 'Cemento gris 42.5kg';
  if not found then raise exception 'FALLO: el renglón no quedó con la identidad Odoo esperada'; end if;
  raise notice 'OK: vincular_item_producto_odoo escribe odoo_product_id/odoo_uom_id/odoo_snapshot completo';
  reset role;

  -- Un usuario sin módulo compras/admin no puede vincular.
  if v_otro_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_otro_id::text, 'role','authenticated')::text, true);
    set local role authenticated;
    begin
      perform sgc.vincular_item_producto_odoo(v_item_id, 999, null, null);
      raise exception 'FALLO: un usuario sin módulo compras pudo vincular';
    exception when others then
      if sqlerrm like '%Solo Compras%' then raise notice 'OK: gate de módulo compras se respeta'; else raise; end if;
    end;
    reset role;
  end if;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY24 (#24): flag odoo_compras_piloto_habilitado + vincular_item_producto_odoo verificados (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY24 (#24) smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
