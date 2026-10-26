// CY19b -- smoke transaccional (ROLLBACK) de odoo_homologacion_vincular_articulo/_bodega.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_instancia_id uuid;
  v_articulo_id uuid;
  v_bodega_id uuid;
  v_r jsonb;
begin
  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('CY19b smoke', 'https://smoke.test', 'smoke', 'dev', true) returning id into v_instancia_id;
  select id into v_articulo_id from sgc.articulos where odoo_product_id is null limit 1;
  select id into v_bodega_id from sgc.bodegas where odoo_location_id is null limit 1;
  if v_articulo_id is null or v_bodega_id is null then raise exception 'FALLO_SETUP: faltan articulo/bodega sin vincular en este entorno'; end if;

  -- ARTICULO: simulacion no escribe.
  v_r := sgc.odoo_homologacion_vincular_articulo(v_articulo_id, v_instancia_id, 8001, 7001, true);
  if (v_r->>'accion') <> 'vinculado' then raise exception 'FALLO articulo simulacion: %', v_r; end if;
  perform 1 from sgc.articulos where id = v_articulo_id and odoo_product_id is not null;
  if found then raise exception 'FALLO: la simulacion de articulo SI escribio'; end if;

  -- ARTICULO: ejecucion real.
  v_r := sgc.odoo_homologacion_vincular_articulo(v_articulo_id, v_instancia_id, 8001, 7001, false);
  if (v_r->>'accion') <> 'vinculado' then raise exception 'FALLO articulo ejecucion: %', v_r; end if;
  perform 1 from sgc.articulos where id = v_articulo_id and odoo_product_id = 8001 and odoo_template_id = 7001;
  if not found then raise exception 'FALLO: la ejecucion de articulo NO escribio ambos ids'; end if;

  -- ARTICULO: idempotente.
  v_r := sgc.odoo_homologacion_vincular_articulo(v_articulo_id, v_instancia_id, 8001, 7001, false);
  if (v_r->>'accion') <> 'ya_vinculado' then raise exception 'FALLO articulo idempotencia: %', v_r; end if;

  -- ARTICULO: conflicto (template_id distinto) -> bloqueado.
  v_r := sgc.odoo_homologacion_vincular_articulo(v_articulo_id, v_instancia_id, 8001, 7002, false);
  if (v_r->>'accion') <> 'conflicto_existente' then raise exception 'FALLO articulo conflicto: %', v_r; end if;
  perform 1 from sgc.articulos where id = v_articulo_id and odoo_template_id = 7001;
  if not found then raise exception 'FALLO: el conflicto de articulo SI sobreescribio'; end if;
  raise notice 'OK: odoo_homologacion_vincular_articulo -- simulacion/ejecucion/idempotencia/conflicto';

  -- BODEGA: solo location_id (warehouse_id opcional) -- simulacion y ejecucion.
  v_r := sgc.odoo_homologacion_vincular_bodega(v_bodega_id, v_instancia_id, 6001, null, true);
  if (v_r->>'accion') <> 'vinculado' then raise exception 'FALLO bodega simulacion: %', v_r; end if;
  v_r := sgc.odoo_homologacion_vincular_bodega(v_bodega_id, v_instancia_id, 6001, null, false);
  if (v_r->>'accion') <> 'vinculado' then raise exception 'FALLO bodega ejecucion: %', v_r; end if;
  perform 1 from sgc.bodegas where id = v_bodega_id and odoo_location_id = 6001 and odoo_warehouse_id is null;
  if not found then raise exception 'FALLO: bodega no quedo con location_id=6001 y warehouse_id null (NO se asume 1:1)'; end if;

  -- BODEGA: completar con warehouse_id despues (location_id coincide, warehouse_id pasa de null a 5001) -> vinculado (completa el dato, no es conflicto).
  v_r := sgc.odoo_homologacion_vincular_bodega(v_bodega_id, v_instancia_id, 6001, 5001, false);
  if (v_r->>'accion') <> 'vinculado' then raise exception 'FALLO bodega completar warehouse: %', v_r; end if;
  perform 1 from sgc.bodegas where id = v_bodega_id and odoo_location_id = 6001 and odoo_warehouse_id = 5001;
  if not found then raise exception 'FALLO: no se completo el warehouse_id'; end if;

  -- BODEGA: conflicto (location_id distinto) -> bloqueado.
  v_r := sgc.odoo_homologacion_vincular_bodega(v_bodega_id, v_instancia_id, 6002, null, false);
  if (v_r->>'accion') <> 'conflicto_existente' then raise exception 'FALLO bodega conflicto: %', v_r; end if;
  perform 1 from sgc.bodegas where id = v_bodega_id and odoo_location_id = 6001;
  if not found then raise exception 'FALLO: el conflicto de bodega SI sobreescribio'; end if;
  raise notice 'OK: odoo_homologacion_vincular_bodega -- simulacion/ejecucion/sin-1a1/conflicto';

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY19b vincular articulo/bodega: simulacion/ejecucion/idempotencia/conflicto/sin-1a1 verificados (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY19b smoke falló:', e.message.slice(0, 1200));
  process.exit(1);
}
