// CY4 -- smoke transaccional (ROLLBACK) de sgc.odoo_vinculos_stock(_lineas).
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_instancia_id uuid;
  v_entrada1_id uuid;
  v_entrada2_id uuid;
  v_salida_id uuid;
  v_bodega_id uuid;
  v_proveedor_id uuid;
  v_usuario_id uuid;
  v_vinculo1_id uuid;
  v_vinculo2_id uuid;
  v_tras_fallo boolean;
begin
  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno)
    values ('CY4 smoke', 'https://smoke.test', 'smoke', 'dev')
    returning id into v_instancia_id;

  select id into v_bodega_id from sgc.bodegas limit 1;
  select id into v_proveedor_id from sgc.proveedores limit 1;
  select id into v_usuario_id from sgc.usuarios limit 1;
  if v_bodega_id is null or v_proveedor_id is null or v_usuario_id is null then
    raise exception 'FALLO_SETUP: faltan bodega/proveedor/usuario de prueba en este entorno';
  end if;

  -- Recepcion dividida: 2 entradas SGC distintas para el MISMO stock.picking Odoo.
  insert into sgc.entradas_inventario (fecha, bodega_id, proveedor_id, referencia, creado_por)
    values (current_date, v_bodega_id, v_proveedor_id, 'CY4-SMOKE-1', v_usuario_id) returning id into v_entrada1_id;
  insert into sgc.entradas_inventario (fecha, bodega_id, proveedor_id, referencia, entrada_origen_id, creado_por)
    values (current_date, v_bodega_id, v_proveedor_id, 'CY4-SMOKE-2', v_entrada1_id, v_usuario_id) returning id into v_entrada2_id;

  insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, entrada_id)
    values (v_instancia_id, 'stock.picking', 9001, 'recepcion_compra', v_entrada1_id) returning id into v_vinculo1_id;
  insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, entrada_id)
    values (v_instancia_id, 'stock.picking', 9001, 'recepcion_parcial', v_entrada2_id) returning id into v_vinculo2_id;
  raise notice 'OK criterio1: 2 vinculos al mismo picking 9001, entradas distintas (% y %)', v_entrada1_id, v_entrada2_id;

  -- Criterio 2: salida + entrada del MISMO traslado -> mismo odoo_id, etapas distintas.
  insert into sgc.salidas_inventario (fecha, bodega_id, motivo, creado_por) values (current_date, v_bodega_id, 'traslado CY4 smoke', v_usuario_id) returning id into v_salida_id;
  insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, salida_id)
    values (v_instancia_id, 'stock.picking', 9002, 'traslado_salida', v_salida_id);
  insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, entrada_id)
    values (v_instancia_id, 'stock.picking', 9002, 'traslado_entrada', v_entrada1_id);
  raise notice 'OK criterio2: salida % y entrada % comparten el picking 9002', v_salida_id, v_entrada1_id;

  -- Criterio 4: reintento EXACTO (misma pareja) no duplica -> debe fallar por el indice unico.
  begin
    insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, entrada_id)
      values (v_instancia_id, 'stock.picking', 9001, 'recepcion_compra', v_entrada1_id);
    raise exception 'FALLO: el reintento exacto NO debio pasar (deberia violar la unicidad)';
  exception when unique_violation then
    raise notice 'OK criterio4: reintento exacto rechazado por unique_violation';
  end;

  -- Criterio 3: borrar el origen conserva el vinculo con la fk en null y origen_borrado_en.
  delete from sgc.entradas_inventario where id = v_entrada2_id;
  select origen_borrado_en is not null into v_tras_fallo from sgc.odoo_vinculos_stock where id = v_vinculo2_id;
  if not v_tras_fallo then raise exception 'FALLO: origen_borrado_en no se sello tras borrar la entrada'; end if;
  perform 1 from sgc.odoo_vinculos_stock where id = v_vinculo2_id and entrada_id is null and origen_sgc_tipo = 'entrada' and origen_sgc_id = v_entrada2_id;
  if not found then raise exception 'FALLO: el vinculo no conservo origen_sgc_tipo/id tras el borrado'; end if;
  raise notice 'OK criterio3: vinculo % sobrevive al borrado de su entrada (fk null, origen_sgc_id conservado, origen_borrado_en sellado)', v_vinculo2_id;

  -- Check: cero FKs de origen -> rechazado.
  begin
    insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa) values (v_instancia_id, 'stock.picking', 9003, 'conteo');
    raise exception 'FALLO: 0 FKs de origen no debio pasar';
  exception when check_violation then raise notice 'OK: 0 FKs de origen rechazado por check'; end;

  -- Check: dos FKs de origen a la vez -> rechazado.
  begin
    insert into sgc.odoo_vinculos_stock (odoo_instancia_id, odoo_modelo, odoo_id, etapa, entrada_id, salida_id)
      values (v_instancia_id, 'stock.picking', 9004, 'conteo', v_entrada1_id, v_salida_id);
    raise exception 'FALLO: 2 FKs de origen no debio pasar';
  exception when check_violation then raise notice 'OK: 2 FKs de origen rechazado por check'; end;

  -- Lineas: una por renglon, no se puede repetir el mismo detalle en el mismo vinculo.
  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
    select v_entrada1_id, id, 5 from sgc.articulos limit 1;
  if not found then raise exception 'FALLO_SETUP: no hay articulos de prueba'; end if;

  raise notice 'TODO OK -- ROLLBACK (nada queda persistido)';
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY4 odoo_vinculos_stock: criterios 1-4 + checks de 1-FK verificados (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY4 smoke falló:', e.message.slice(0, 1200));
  process.exit(1);
}
