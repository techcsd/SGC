// CY19 -- smoke transaccional (ROLLBACK) de sgc.odoo_homologacion_vincular.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_instancia_id uuid;
  v_proveedor_id uuid;
  v_otro_usuario_id uuid;
  v_r jsonb;
begin
  insert into sgc.odoo_instancias (nombre, base_url, base_datos, entorno, habilitada)
    values ('CY19 smoke', 'https://smoke.test', 'smoke', 'dev', true) returning id into v_instancia_id;
  select id into v_proveedor_id from sgc.proveedores where odoo_id is null limit 1;
  if v_proveedor_id is null then raise exception 'FALLO_SETUP: no hay proveedor sin odoo_id en este entorno'; end if;

  -- Simulacion: no escribe.
  v_r := sgc.odoo_homologacion_vincular(
    jsonb_build_array(jsonb_build_object('tabla','proveedores','sgc_id',v_proveedor_id::text,'odoo_instancia_id',v_instancia_id::text,'odoo_id',77001)),
    true
  );
  if (v_r->'resultados'->0->>'accion') <> 'vinculado' then raise exception 'FALLO simulacion: %', v_r; end if;
  perform 1 from sgc.proveedores where id = v_proveedor_id and odoo_id is not null;
  if found then raise exception 'FALLO: la simulacion SI escribio (no deberia)'; end if;
  raise notice 'OK: simulacion no escribe (%).', v_r->'resultados'->0->>'detalle';

  -- Ejecucion real: escribe.
  v_r := sgc.odoo_homologacion_vincular(
    jsonb_build_array(jsonb_build_object('tabla','proveedores','sgc_id',v_proveedor_id::text,'odoo_instancia_id',v_instancia_id::text,'odoo_id',77001)),
    false
  );
  if (v_r->'resultados'->0->>'accion') <> 'vinculado' then raise exception 'FALLO ejecucion: %', v_r; end if;
  perform 1 from sgc.proveedores where id = v_proveedor_id and odoo_id = 77001;
  if not found then raise exception 'FALLO: la ejecucion NO escribio'; end if;
  raise notice 'OK: ejecucion real escribe odoo_id=77001';

  -- Idempotencia: repetir el MISMO vinculo -> ya_vinculado, sin error.
  v_r := sgc.odoo_homologacion_vincular(
    jsonb_build_array(jsonb_build_object('tabla','proveedores','sgc_id',v_proveedor_id::text,'odoo_instancia_id',v_instancia_id::text,'odoo_id',77001)),
    false
  );
  if (v_r->'resultados'->0->>'accion') <> 'ya_vinculado' then raise exception 'FALLO idempotencia: %', v_r; end if;
  raise notice 'OK: repetir el mismo vinculo da ya_vinculado (idempotente)';

  -- Conflicto: mismo proveedor, odoo_id DISTINTO -> bloqueado, no sobrescribe.
  v_r := sgc.odoo_homologacion_vincular(
    jsonb_build_array(jsonb_build_object('tabla','proveedores','sgc_id',v_proveedor_id::text,'odoo_instancia_id',v_instancia_id::text,'odoo_id',77002)),
    false
  );
  if (v_r->'resultados'->0->>'accion') <> 'conflicto_existente' then raise exception 'FALLO conflicto: %', v_r; end if;
  perform 1 from sgc.proveedores where id = v_proveedor_id and odoo_id = 77001;
  if not found then raise exception 'FALLO: el conflicto SI sobreescribio el odoo_id original'; end if;
  raise notice 'OK: odoo_id distinto se bloquea como conflicto_existente, no sobreescribe';

  -- Tabla no soportada (articulos: siguiente migracion) -> rechazado.
  v_r := sgc.odoo_homologacion_vincular(
    jsonb_build_array(jsonb_build_object('tabla','articulos','sgc_id',v_proveedor_id::text,'odoo_instancia_id',v_instancia_id::text,'odoo_id',1)),
    true
  );
  if (v_r->'resultados'->0->>'accion') <> 'rechazado' then raise exception 'FALLO tabla no soportada: %', v_r; end if;
  raise notice 'OK: tabla no soportada (articulos) se rechaza con explicacion';

  -- Instancia no habilitada -> rechazado.
  v_r := sgc.odoo_homologacion_vincular(
    jsonb_build_array(jsonb_build_object('tabla','proveedores','sgc_id',v_proveedor_id::text,'odoo_instancia_id',gen_random_uuid()::text,'odoo_id',1)),
    true
  );
  if (v_r->'resultados'->0->>'accion') <> 'rechazado' then raise exception 'FALLO instancia invalida: %', v_r; end if;
  raise notice 'OK: instancia Odoo inexistente/no-habilitada se rechaza';

  -- Permiso: un usuario sin admin no puede llamar la RPC.
  select id into v_otro_usuario_id from sgc.usuarios u
    where not exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where ur.usuario_id=u.id and 'admin'=any(r.modulos))
    limit 1;
  if v_otro_usuario_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_otro_usuario_id::text, 'role','authenticated')::text, true);
    set local role authenticated;
    begin
      perform sgc.odoo_homologacion_vincular(jsonb_build_array(jsonb_build_object('tabla','proveedores','sgc_id',v_proveedor_id::text,'odoo_instancia_id',v_instancia_id::text,'odoo_id',1)), true);
      raise exception 'FALLO: un usuario sin admin SI pudo vincular';
    exception when others then
      if sqlerrm like '%Solo admin%' then raise notice 'OK: usuario sin admin rechazado (42501)'; else raise; end if;
    end;
    reset role;
  else
    raise notice 'AVISO: no habia usuario no-admin de prueba -- se omitio el check de permiso';
  end if;

  raise notice 'TODO OK -- ROLLBACK';
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CY19 odoo_homologacion_vincular: simulacion/ejecucion/idempotencia/conflicto/rechazos/permiso verificados (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CY19 smoke falló:', e.message.slice(0, 1200));
  process.exit(1);
}
