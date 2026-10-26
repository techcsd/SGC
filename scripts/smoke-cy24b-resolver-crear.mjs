// CY24 Fase B -- smoke transaccional (ROLLBACK) de crear_solicitud_producto_odoo,
// el marcado de origen='odoo' al crear, y productos_por_dar_de_alta_count.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_categoria_id integer;
  v_solicitante_id uuid;
  v_resolutor_id uuid;
  v_solicitud_id uuid;
  v_articulo_id uuid;
  v_resultado jsonb;
  v_count_antes integer;
  v_count_despues integer;
begin
  select id into v_categoria_id from sgc.categorias_inventario limit 1;
  select ur.usuario_id into v_solicitante_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select ur.usuario_id into v_resolutor_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where ('compras'=any(r.modulos) or 'admin'=any(r.modulos)) and ur.usuario_id <> v_solicitante_id limit 1;
  if v_categoria_id is null or v_solicitante_id is null or v_resolutor_id is null then
    raise exception 'FALLO_SETUP: faltan datos de prueba';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_solicitante_id::text, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Criterio 7: sin busqueda_previa -> rechazado.
  begin
    perform sgc.crear_solicitud_producto_odoo('Tornillo especial', '   ', null, null);
    raise exception 'FALLO: acepto una solicitud sin busqueda previa';
  exception when others then
    if sqlerrm like '%buscaste%' then raise notice 'OK: sin busqueda previa se rechaza (criterio 7)'; else raise; end if;
  end;

  -- Sin descripcion -> rechazado.
  begin
    perform sgc.crear_solicitud_producto_odoo('   ', 'busque tornillo', null, null);
    raise exception 'FALLO: acepto una solicitud sin descripcion';
  exception when others then
    if sqlerrm like '%descripción%' then raise notice 'OK: sin descripcion se rechaza'; else raise; end if;
  end;

  -- Alta valida.
  v_solicitud_id := sgc.crear_solicitud_producto_odoo('Tornillo especial M10', 'busque "tornillo m10" y "m10 especial", no aparecio', null, null);
  if v_solicitud_id is null then raise exception 'FALLO: no se creo la solicitud'; end if;
  raise notice 'OK: solicitud creada con busqueda previa real';

  reset role;

  -- El conteo (SECURITY INVOKER, respeta RLS real) debe subir al menos 1 para
  -- un resolutor que puede ver todas (admin/compras).
  perform set_config('request.jwt.claims', json_build_object('sub', v_resolutor_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select sgc.productos_por_dar_de_alta_count() into v_count_antes;
  if v_count_antes < 1 then raise exception 'FALLO: el conteo no ve la solicitud recien creada (esperaba >=1, vio %)', v_count_antes; end if;
  raise notice 'OK: productos_por_dar_de_alta_count ve la solicitud pendiente (%)', v_count_antes;

  -- Resolver como 'creado' -> el articulo resultante debe quedar origen='odoo'.
  insert into sgc.articulos (codigo, nombre, categoria_id, unidad, origen)
    values ('CY24B-SMOKE', 'Tornillo especial M10', v_categoria_id, 'unidad', 'sgc') -- nace 'sgc' a proposito, el RPC debe corregirlo a 'odoo'
    returning id into v_articulo_id;
  v_resultado := sgc.resolver_solicitud_producto(v_solicitud_id, 'creado', v_articulo_id, 'alta como articulo-sombra');
  reset role;
  if not (v_resultado->>'ok')::boolean then raise exception 'FALLO: no se pudo resolver: %', v_resultado; end if;

  perform 1 from sgc.articulos where id = v_articulo_id and origen = 'odoo';
  if not found then raise exception 'FALLO: el articulo creado NO quedo con origen=odoo (D-10)'; end if;
  raise notice 'OK: resolver con decision=creado marca origen=odoo en el articulo resultante (D-10)';

  -- El conteo baja despues de resolver.
  perform set_config('request.jwt.claims', json_build_object('sub', v_resolutor_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select sgc.productos_por_dar_de_alta_count() into v_count_despues;
  reset role;
  if v_count_despues >= v_count_antes then raise exception 'FALLO: el conteo no bajo tras resolver (antes=%, despues=%)', v_count_antes, v_count_despues; end if;
  raise notice 'OK: el conteo baja tras resolver (% -> %)', v_count_antes, v_count_despues;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY24 Fase B: crear_solicitud_producto_odoo (criterio 7), productos_por_dar_de_alta_count, origen=odoo al crear (D-10) verificados (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY24 Fase B smoke falló:', e.message.slice(0, 1500));
  process.exit(1);
}
