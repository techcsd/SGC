// CY24 Fase C -- smoke transaccional (ROLLBACK) de sgc.oc_para_comando +
// sgc.registrar_publicacion_oc (identidad odoo_id fijada UNA sola vez).
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_compras_id uuid;
  v_proveedor_id uuid;
  v_categoria_id integer;
  v_instancia_id uuid;
  v_orden_id uuid;
  v_orden_prueba_id uuid;
  v_resultado jsonb;
begin
  select ur.usuario_id into v_compras_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select id into v_categoria_id from sgc.categorias_inventario limit 1;
  if v_compras_id is null or v_categoria_id is null then raise exception 'FALLO_SETUP'; end if;

  insert into sgc.proveedores (nombre, activo) values ('SMOKE-CY24I proveedor', true) returning id into v_proveedor_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  v_orden_id := sgc.crear_orden_compra(
    v_proveedor_id, null, 'borrador', current_date, null, 100, 18, 118, 'smoke cy24i', v_compras_id,
    jsonb_build_array(jsonb_build_object('articulo_id', null, 'descripcion', 'renglón smoke', 'cantidad', 1, 'precio_unitario', 100, 'total', 100)),
    'oficina', true, false
  );
  v_orden_prueba_id := sgc.crear_orden_compra(
    v_proveedor_id, null, 'borrador', current_date, null, 100, 18, 118, 'smoke cy24i prueba', v_compras_id,
    jsonb_build_array(jsonb_build_object('articulo_id', null, 'descripcion', 'renglón smoke prueba', 'cantidad', 1, 'precio_unitario', 100, 'total', 100)),
    'oficina', true, true -- es_prueba
  );

  -- odoo_instancias/odoo_id son columnas protegidas por F5 -- fuera de authenticated.
  -- Se crea ANTES de los escenarios 1/2 para que su rechazo sea por "no publicada"/
  -- "es_prueba", no por "sin instancia habilitada" (chequeo previo en oc_para_comando).
  reset role;
  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('smoke-cy24i', 'https://smoke.test', 'db_smoke', 'dev', true)
    returning id into v_instancia_id;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);

  -- 1. Nunca publicada (odoo_id null) -> oc_para_comando rechaza confirmar.
  begin
    perform sgc.oc_para_comando(v_orden_id, 'confirmar');
    raise exception 'FALLO: confirmó sin publicar antes';
  exception when others then
    if sqlerrm like '%todavía no se ha publicado%' then raise notice 'OK: sin publicar antes, confirmar se rechaza'; else raise; end if;
  end;

  -- 2. es_prueba nunca se toca, ni para comandos de confirmar/cancelar (D-16/E10).
  begin
    perform sgc.oc_para_comando(v_orden_prueba_id, 'confirmar');
    raise exception 'FALLO: confirmó una OC es_prueba';
  exception when others then
    if sqlerrm like '%prueba%' then raise notice 'OK: una OC es_prueba nunca se toca en Odoo (D-16/E10)'; else raise; end if;
  end;

  -- 3. Simula una publicación exitosa (lo que haría compras.crear vía registrar_publicacion_oc).
  perform sgc.registrar_publicacion_oc(v_orden_id, 'publicada', 'draft', 'P99999-MOCK', null, null, v_instancia_id, 999002);
  if (select odoo_id from sgc.ordenes_compra where id = v_orden_id) <> 999002 then
    raise exception 'FALLO: registrar_publicacion_oc no fijó odoo_id';
  end if;

  -- 4. Identidad se fija UNA sola vez: un segundo registro con odoo_id distinto NO la pisa.
  perform sgc.registrar_publicacion_oc(v_orden_id, 'publicada', null, null, null, null, v_instancia_id, 1);
  if (select odoo_id from sgc.ordenes_compra where id = v_orden_id) <> 999002 then
    raise exception 'FALLO: la identidad odoo_id se sobrescribió en un segundo registro';
  end if;
  raise notice 'OK: odoo_instancia_id/odoo_id se fijan una sola vez (identidad protegida)';

  -- 5. Ya publicada -> oc_para_comando confirmar ensambla correctamente.
  v_resultado := sgc.oc_para_comando(v_orden_id, 'confirmar');
  if (v_resultado->>'odoo_id')::bigint <> 999002 then raise exception 'FALLO: oc_para_comando no devolvió el odoo_id correcto'; end if;
  raise notice 'OK: oc_para_comando(confirmar) ensambla correctamente tras publicar: %', v_resultado;

  -- 6. Confirma (simulando el resultado del edge) y verifica que confirmar de nuevo se rechaza.
  perform sgc.registrar_publicacion_oc(v_orden_id, 'confirmada', 'purchase');
  begin
    perform sgc.oc_para_comando(v_orden_id, 'confirmar');
    raise exception 'FALLO: confirmó una OC ya confirmada';
  exception when others then
    if sqlerrm like '%ya está confirmada%' then raise notice 'OK: una OC ya confirmada no se vuelve a confirmar'; else raise; end if;
  end;

  -- 7. Cancelar una confirmada SÍ es válido (Odoo permite cancelar una purchase order confirmada).
  v_resultado := sgc.oc_para_comando(v_orden_id, 'cancelar');
  raise notice 'OK: cancelar una OC confirmada se permite: %', v_resultado;

  -- 8. Tras cancelar, ni confirmar ni cancelar de nuevo se permiten.
  perform sgc.registrar_publicacion_oc(v_orden_id, 'cancelada', 'cancel');
  begin
    perform sgc.oc_para_comando(v_orden_id, 'cancelar');
    raise exception 'FALLO: canceló una OC ya cancelada';
  exception when others then
    if sqlerrm like '%ya está cancelada%' then raise notice 'OK: una OC ya cancelada no se vuelve a cancelar'; else raise; end if;
  end;
  begin
    perform sgc.oc_para_comando(v_orden_id, 'confirmar');
    raise exception 'FALLO: confirmó una OC ya cancelada';
  exception when others then
    if sqlerrm like '%ya está cancelada%' then raise notice 'OK: una OC cancelada tampoco se puede confirmar'; else raise; end if;
  end;

  reset role;
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY24 Fase C: oc_para_comando + identidad odoo_id de registrar_publicacion_oc verificado (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY24i smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
