// CY25 -- smoke transaccional (ROLLBACK): asegurar_proveedor_odoo / vincular_proveedor_odoo
// (idempotencia, conflictos, sin outbox) y crear_solicitud_compra con producto de Odoo.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_compras_id uuid;
  v_proyecto_id uuid;
  v_prov_a uuid;
  v_prov_b uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_eventos_antes bigint;
  v_eventos_despues bigint;
  v_sid uuid;
  v_n integer;
  v_odoo_pid bigint;
  v_snap jsonb;
begin
  select ur.usuario_id into v_compras_id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where 'compras'=any(r.modulos) or 'admin'=any(r.modulos) limit 1;
  select id into v_proyecto_id from sgc.proyectos limit 1;
  if v_compras_id is null or v_proyecto_id is null then raise exception 'FALLO_SETUP: falta usuario de compras o proyecto'; end if;

  -- Una instancia habilitada (dev puede no tener ninguna); todo se revierte con el ROLLBACK.
  if not exists (select 1 from sgc.odoo_instancias where habilitada) then
    insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
      values ('smoke-cy25', 'https://smoke.test', 'db_smoke', 'dev', true);
  end if;

  insert into sgc.proveedores (nombre, activo) values ('SMOKE-CY25 A', true) returning id into v_prov_a;
  insert into sgc.proveedores (nombre, activo) values ('SMOKE-CY25 B', true) returning id into v_prov_b;

  -- asegurar: crea una vez, idempotente, no pisa el nombre, sin eventos de outbox.
  select count(*) into v_eventos_antes from sgc.odoo_eventos;
  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_id1 := sgc.asegurar_proveedor_odoo(999000001, '  SMOKE-CY25 proveedor ');
  v_id2 := sgc.asegurar_proveedor_odoo(999000001, 'otro nombre');
  if v_id1 is distinct from v_id2 then raise exception 'FALLO: asegurar no es idempotente'; end if;
  if (select nombre from sgc.proveedores where id = v_id1) <> 'SMOKE-CY25 proveedor' then raise exception 'FALLO: nombre no normalizado o pisado'; end if;
  reset role;
  select count(*) into v_eventos_despues from sgc.odoo_eventos;
  perform set_config('request.jwt.claims', json_build_object('sub', v_compras_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  if v_eventos_despues <> v_eventos_antes then raise exception 'FALLO: asegurar encoló eventos de outbox (% -> %)', v_eventos_antes, v_eventos_despues; end if;
  raise notice 'OK: asegurar_proveedor_odoo idempotente y sin outbox';

  begin
    perform sgc.asegurar_proveedor_odoo(999000002, '   ');
    raise exception 'FALLO: aceptó nombre vacío';
  exception when others then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: nombre vacío rechazado';
  end;

  -- vincular: mismo vínculo = no-op; otro odoo_id o uno ya usado = error.
  if not sgc.vincular_proveedor_odoo(v_prov_a, 999000010) then raise exception 'FALLO: vincular devolvió false'; end if;
  if not sgc.vincular_proveedor_odoo(v_prov_a, 999000010) then raise exception 'FALLO: vincular no es idempotente'; end if;
  begin
    perform sgc.vincular_proveedor_odoo(v_prov_a, 999000011);
    raise exception 'FALLO: pisó el vínculo existente';
  exception when others then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: no pisa un vínculo distinto';
  end;
  begin
    perform sgc.vincular_proveedor_odoo(v_prov_b, 999000010);
    raise exception 'FALLO: vinculó un odoo_id ya usado';
  exception when others then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: odoo_id repetido rechazado';
  end;

  -- crear_solicitud_compra: renglón viejo intacto + renglón con producto de Odoo.
  v_sid := sgc.crear_solicitud_compra(v_proyecto_id, v_compras_id, 'smoke cy25', '[
    {"descripcion":"viejo","cantidad":1},
    {"descripcion":"odoo","cantidad":2,"odoo_product_id":123,"odoo_uom_id":4,"odoo_snapshot":{"nombre":"X"}}
  ]'::jsonb);
  select count(*) into v_n from sgc.solicitud_compra_items where solicitud_id = v_sid;
  if v_n <> 2 then raise exception 'FALLO: esperaba 2 renglones, hay %', v_n; end if;
  select odoo_product_id, odoo_snapshot into v_odoo_pid, v_snap from sgc.solicitud_compra_items where solicitud_id = v_sid and descripcion = 'odoo';
  if v_odoo_pid <> 123 or v_snap->>'nombre' <> 'X' then raise exception 'FALLO: no guardó el producto de Odoo'; end if;
  if exists (select 1 from sgc.solicitud_compra_items where solicitud_id = v_sid and descripcion = 'viejo' and odoo_product_id is not null) then
    raise exception 'FALLO: el renglón viejo recibió datos de Odoo';
  end if;
  begin
    perform sgc.crear_solicitud_compra(v_proyecto_id, v_compras_id, 'x', '[{"descripcion":"a","cantidad":1,"odoo_product_id":0}]'::jsonb);
    raise exception 'FALLO: aceptó odoo_product_id inválido';
  exception when others then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: odoo_product_id inválido rechazado';
  end;
  raise notice 'OK: crear_solicitud_compra guarda el producto de Odoo y respeta renglones viejos';
end
$$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY25: asegurar/vincular proveedor + solicitud con producto Odoo verificados (ROLLBACK limpio)');
} catch (e) {
  console.error('✗ CY25 smoke falló:', e instanceof Error ? e.message : e);
  process.exit(1);
}
