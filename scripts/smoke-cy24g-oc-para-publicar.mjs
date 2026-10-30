// CY24 Fase C -- smoke transaccional (ROLLBACK) de sgc.oc_para_publicar:
// valida D-16/E9/E10/criterio-6 antes de que el edge toque Odoo de verdad.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_compras_id uuid;
  v_proveedor_sin_odoo_id uuid;
  v_proveedor_con_odoo_id uuid;
  v_categoria_id integer;
  v_orden_id uuid;
  v_orden_prueba_id uuid;
  v_item_id uuid;
  v_resultado jsonb;
  v_instancia_id uuid;
begin
  select ur.usuario_id into v_compras_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select id into v_categoria_id from sgc.categorias_inventario limit 1;
  if v_compras_id is null or v_categoria_id is null then raise exception 'FALLO_SETUP'; end if;

  -- Proveedor real, SIN vínculo a Odoo (caso común hoy -- 0% tiene odoo_id).
  insert into sgc.proveedores (nombre, activo) values ('SMOKE-CY24G proveedor sin odoo', true) returning id into v_proveedor_sin_odoo_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Crea una OC real vía la RPC real (D7 -- no se toca crear_orden_compra).
  v_orden_id := sgc.crear_orden_compra(
    v_proveedor_sin_odoo_id, null, 'borrador', current_date, null, 100, 18, 118, 'smoke cy24g', v_compras_id,
    jsonb_build_array(jsonb_build_object('articulo_id', null, 'descripcion', 'renglón smoke', 'cantidad', 1, 'precio_unitario', 100, 'total', 100)),
    'oficina', true, false
  );

  -- 1. Sin instancia habilitada -> error claro (hoy dev/prod tienen 0 habilitadas).
  begin
    perform sgc.oc_para_publicar(v_orden_id);
    raise exception 'FALLO: publicó sin instancia Odoo habilitada';
  exception when others then
    if sqlerrm like '%instancia de Odoo habilitada%' then raise notice 'OK: sin instancia habilitada se rechaza'; else raise; end if;
  end;

  -- odoo_id/odoo_instancia_id/odoo_compania_id son columnas protegidas por el
  -- trigger de F5 (odoo_v1_proteger_campos) -- solo escribibles como
  -- service_role/postgres/supabase_admin, así que esto se hace fuera del rol authenticated.
  reset role;
  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('smoke-cy24g', 'https://smoke.test', 'db_smoke', 'dev', true)
    returning id into v_instancia_id;
  insert into sgc.odoo_companias (instancia_id, odoo_id, nombre) values (v_instancia_id, 1, 'Smoke Co');
  insert into sgc.proveedores (nombre, activo, odoo_instancia_id, odoo_compania_id, odoo_id)
    values ('SMOKE-CY24G proveedor con odoo', true, v_instancia_id, 1, 999001)
    returning id into v_proveedor_con_odoo_id;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);

  v_orden_prueba_id := sgc.crear_orden_compra(
    v_proveedor_con_odoo_id, null, 'borrador', current_date, null, 100, 18, 118, 'smoke cy24g prueba', v_compras_id,
    jsonb_build_array(jsonb_build_object('articulo_id', null, 'descripcion', 'renglón smoke prueba', 'cantidad', 1, 'precio_unitario', 100, 'total', 100)),
    'oficina', true, true -- es_prueba
  );

  -- 2. es_prueba nunca se publica (D-16/E10), aunque el proveedor SÍ tenga odoo_id.
  begin
    perform sgc.oc_para_publicar(v_orden_prueba_id);
    raise exception 'FALLO: publicó una OC es_prueba';
  exception when others then
    if sqlerrm like '%prueba%' then raise notice 'OK: una OC es_prueba nunca se publica (D-16/E10)'; else raise; end if;
  end;

  -- 3. Proveedor sin odoo_id -> bloquea con mensaje claro (E9).
  begin
    perform sgc.oc_para_publicar(v_orden_id);
    raise exception 'FALLO: publicó con proveedor sin vínculo a Odoo';
  exception when others then
    if sqlerrm like '%no está vinculado a Odoo%' then raise notice 'OK: proveedor sin odoo_id bloquea (E9)'; else raise; end if;
  end;

  -- 4. Línea sin odoo_product_id -> bloquea (criterio 6). Reapunta a un proveedor con odoo_id.
  -- (reset role porque la RLS de UPDATE de ordenes_compra para 'compras' podría
  -- no cubrir re-asignar proveedor_id -- no es parte de lo que se está probando aquí.)
  reset role;
  update sgc.ordenes_compra set proveedor_id = v_proveedor_con_odoo_id where id = v_orden_id;
  if (select proveedor_id from sgc.ordenes_compra where id = v_orden_id) is distinct from v_proveedor_con_odoo_id then
    raise exception 'DEBUG: el update de proveedor_id no tomó -- actual=%, esperado=%', (select proveedor_id from sgc.ordenes_compra where id = v_orden_id), v_proveedor_con_odoo_id;
  end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);
  begin
    perform sgc.oc_para_publicar(v_orden_id);
    raise exception 'FALLO: publicó con una línea sin producto Odoo';
  exception when others then
    if sqlerrm like '%línea(s)%' then raise notice 'OK: línea sin odoo_product_id bloquea (criterio 6)'; else raise; end if;
  end;

  -- 5. Camino feliz: vincula la línea a un producto Odoo y confirma el ensamblado.
  select id into v_item_id from sgc.orden_compra_items where orden_id = v_orden_id limit 1;
  update sgc.orden_compra_items set odoo_product_id = 4821, odoo_uom_id = 1 where id = v_item_id;
  v_resultado := sgc.oc_para_publicar(v_orden_id);
  if (v_resultado->>'odoo_proveedor_id')::bigint <> 999001 then raise exception 'FALLO: odoo_proveedor_id no coincide'; end if;
  if jsonb_array_length(v_resultado->'lineas') <> 1 then raise exception 'FALLO: no ensambló las líneas'; end if;
  raise notice 'OK: camino feliz ensambla proveedor+líneas correctamente: %', v_resultado;

  reset role;
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY24 Fase C: oc_para_publicar (D-16/E9/E10/criterio 6) verificado (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY24g smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
