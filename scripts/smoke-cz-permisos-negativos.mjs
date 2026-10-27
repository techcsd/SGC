// smoke-cz-permisos-negativos.mjs — DZ-22 (ronda CZ). Verifica que el Vault y
// el Subadministrador rechazan a quien no corresponde (no solo que el
// correcto puede). Transaccional, ROLLBACK, no persiste nada. Usuarios
// SINTÉTICOS (insertados en auth.users dentro de la misma tx) para garantizar
// EXACTAMENTE los roles que el test necesita — mismo patrón de
// smoke-cw-permisos-negativos.mjs.
//
//   node scripts/smoke-cz-permisos-negativos.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_admin_id uuid;
  v_subadmin uuid := gen_random_uuid();
  v_ingeniero uuid := gen_random_uuid();
  v_entrada_id uuid;
  v_err text;
begin
  select ur.usuario_id into v_admin_id from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin_id is null then raise exception 'FALLO_SETUP: no hay usuario admin real en este entorno'; end if;

  insert into auth.users (id) values (v_subadmin), (v_ingeniero);
  insert into sgc.usuarios (id, nombre, email, activo) values
    (v_subadmin, 'CZ-SMOKE Subadmin', 'cz-smoke-subadmin@dev.constructorasd.local', true),
    (v_ingeniero, 'CZ-SMOKE Ingeniero', 'cz-smoke-ingeniero@dev.constructorasd.local', true);
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
    select v_subadmin, id, v_admin_id from sgc.roles where codigo = 'subadmin';
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
    select v_ingeniero, id, v_admin_id from sgc.roles where codigo = 'ingeniero_campo';

  -- Una entrada real del Vault (insertada con privilegios del script, simulando
  -- lo que la edge haría con service_role) para probar visibilidad/columnas.
  insert into sgc.boveda_entradas (id, tipo, nombre, usuario_texto, valor_cifrado, valor_iv, creado_por)
  values (gen_random_uuid(), 'cuenta', 'CZ-SMOKE entrada', 'alguien', decode('deadbeef','hex'), decode('000000000000000000000000','hex'), v_admin_id)
  returning id into v_entrada_id;

  -- #1 — admin: puede_ver_vault()=true, es_tecnologia sigue intacto.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  if not sgc.puede_ver_vault() then raise exception 'FALLO #1: admin deberia poder ver el Vault'; end if;
  if (select count(*) from sgc.boveda_entradas where id = v_entrada_id) <> 1 then
    raise exception 'FALLO #1b: admin no vio la entrada del Vault (RLS)';
  end if;
  -- Column-level: ni el admin puede SELECT la columna cifrada directamente (DZ-09).
  begin
    perform (select valor_cifrado from sgc.boveda_entradas where id = v_entrada_id);
    raise exception 'FALLO #1c: se pudo SELECT valor_cifrado directamente (deberia estar REVOKEado)';
  exception when insufficient_privilege then
    raise notice 'OK #1c: SELECT de valor_cifrado negado por privilegio de columna, incluso a admin';
  end;
  -- Ni admin puede escribir directo a la tabla (solo la edge con service_role puede).
  begin
    insert into sgc.boveda_entradas (tipo, nombre) values ('nota', 'no deberia poder');
    raise exception 'FALLO #1d: admin pudo INSERT directo en boveda_entradas (deberia ser edge-only)';
  exception when insufficient_privilege then
    raise notice 'OK #1d: INSERT directo negado (sin grant a authenticated, solo service_role via la edge)';
  end;
  reset role;

  -- #2 — Subadministrador: NO ve el Vault, SÍ ve Cotizaciones.
  perform set_config('request.jwt.claims', json_build_object('sub', v_subadmin::text, 'role','authenticated')::text, true);
  set local role authenticated;
  if sgc.puede_ver_vault() then raise exception 'FALLO #2: el Subadministrador NO deberia poder ver el Vault'; end if;
  if (select count(*) from sgc.boveda_entradas where id = v_entrada_id) <> 0 then
    raise exception 'FALLO #2b: el Subadministrador vio una entrada del Vault (RLS)';
  end if;
  if sgc.is_admin() then raise exception 'FALLO #2c: el Subadministrador no debe ser is_admin()'; end if;
  if not sgc.puede_ver_submodulo('tecnologia.cotizaciones') then
    raise exception 'FALLO #2d: el Subadministrador deberia ver Cotizaciones (permiso granular)';
  end if;
  if sgc.tiene_modulo('admin') then raise exception 'FALLO #2e: el Subadministrador no debe tener el modulo admin'; end if;
  if sgc.tiene_modulo('tecnologia') then raise exception 'FALLO #2f: el Subadministrador no debe tener el modulo tecnologia completo'; end if;
  if sgc.es_tecnologia() then raise exception 'FALLO #2g: el Subadministrador no debe ser es_tecnologia() (bloquea Odoo-sync/monitoreo/APIs/QA/Issues/Dev notes)'; end if;
  reset role;
  raise notice 'OK #2: Subadministrador sin Vault/admin/tecnologia completo, con Cotizaciones';

  -- #3 — Alguien sin ningun rol relevante (ingeniero de campo): sin Vault, sin Cotizaciones.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ingeniero::text, 'role','authenticated')::text, true);
  set local role authenticated;
  if sgc.puede_ver_vault() then raise exception 'FALLO #3: un ingeniero de campo no deberia ver el Vault'; end if;
  if sgc.puede_ver_submodulo('tecnologia.cotizaciones') then raise exception 'FALLO #3b: un ingeniero de campo no deberia ver Cotizaciones'; end if;
  reset role;

  -- #4 — Sin sesión (anon): ambos predicados responden false, sin reventar.
  perform set_config('request.jwt.claims', '', true);
  reset role;
  if sgc.puede_ver_vault() then raise exception 'FALLO #4: sin sesion no deberia ver el Vault'; end if;

  -- #5 — boveda_accesos es APPEND-ONLY: ni admin puede UPDATE/DELETE un registro de auditoría.
  insert into sgc.boveda_accesos (usuario_id, entrada_id, accion) values (v_admin_id, v_entrada_id, 'revelar');
  begin
    update sgc.boveda_accesos set detalle = 'manipulado' where entrada_id = v_entrada_id;
    raise exception 'FALLO #5: se pudo UPDATE un registro de boveda_accesos (deberia ser imposible, trigger)';
  exception when others then
    if sqlerrm like '%solo-insertar%' then raise notice 'OK #5: boveda_accesos bloquea UPDATE (trigger append-only)'; else raise; end if;
  end;
  begin
    delete from sgc.boveda_accesos where entrada_id = v_entrada_id;
    raise exception 'FALLO #5b: se pudo DELETE un registro de boveda_accesos';
  exception when others then
    if sqlerrm like '%solo-insertar%' then raise notice 'OK #5b: boveda_accesos bloquea DELETE (trigger append-only)'; else raise; end if;
  end;

  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ CZ (DZ-22): Vault solo-admin (ni SELECT de columnas cifradas ni INSERT directo, ni para admin), Subadministrador sin Vault/admin/tecnologia-completo pero con Cotizaciones, ingeniero de campo sin ninguno, anon seguro, boveda_accesos append-only (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CZ permisos-negativos smoke falló:', e.message.slice(0, 2500));
  process.exit(1);
}
