// smoke-cw-permisos-negativos.mjs — PROMPT-114, verificación de seguridad de
// las RPCs nuevas: confirma que un usuario SIN el permiso correcto es
// RECHAZADO (no solo que el usuario correcto es aceptado). Transaccional,
// ROLLBACK, no persiste nada.
//
//   node scripts/smoke-cw-permisos-negativos.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_abogado uuid := gen_random_uuid(); v_logistica uuid; v_chofer uuid; v_admin uuid;
begin
  select ur.usuario_id into v_logistica from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'logistica' limit 1;
  select ur.usuario_id into v_chofer from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'chofer_transportista' limit 1;
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_logistica is null or v_chofer is null or v_admin is null then
    raise exception 'Faltan usuarios QA de prueba en este entorno (logistica/chofer_transportista/admin)';
  end if;

  -- Usuario sintético con SOLO el rol abogado (sin módulo flota, no admin) —
  -- no se puede confiar en un usuario QA existente: en este entorno "QA abogado"
  -- también tiene el rol gerencia (sí incluye flota), lo cual habría dado un
  -- falso negativo. Sintético = garantiza exactamente un rol, sin flota.
  insert into auth.users (id) values (v_abogado);
  insert into sgc.usuarios (id, nombre, email, activo)
  values (v_abogado, 'Smoke sin-flota', 'smoke-sinflota@dev.constructorasd.local', true);
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
  select v_abogado, r.id, v_admin from sgc.roles r where r.codigo = 'abogado';

  -- #1 — conduces_huerfanos: abogado (sin admin) debe ver CERO filas (RLS vía WHERE is_admin()).
  perform set_config('request.jwt.claims', json_build_object('sub', v_abogado, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select count(*) from sgc.conduces_huerfanos(0)) <> 0 then
    raise exception 'FAIL #1: abogado (no admin) vio filas en conduces_huerfanos';
  end if;

  -- #2 — conduces_huerfanos: logistica (flota-elevado, NO admin) también debe ver CERO
  -- (CW8: se restringió a solo-admin a propósito, coherente con anular_conduce).
  perform set_config('request.jwt.claims', json_build_object('sub', v_logistica, 'role', 'authenticated')::text, true);
  if (select count(*) from sgc.conduces_huerfanos(0)) <> 0 then
    raise exception 'FAIL #2: logistica (flota-elevado, no admin) vio filas en conduces_huerfanos';
  end if;

  -- #3 — reporte_rendimiento_vehiculos: abogado (sin módulo flota, no admin) → excepción 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', v_abogado, 'role', 'authenticated')::text, true);
  begin
    perform sgc.reporte_rendimiento_vehiculos(current_date - 7, current_date, null);
    raise exception 'FAIL #3: abogado pudo leer el reporte de rendimiento (no tiene módulo flota)';
  exception when sqlstate '42501' then null;
  end;

  -- #4 — reporte_rendimiento_vehiculos: chofer_transportista (tiene módulo flota) SÍ puede.
  perform set_config('request.jwt.claims', json_build_object('sub', v_chofer, 'role', 'authenticated')::text, true);
  perform sgc.reporte_rendimiento_vehiculos(current_date - 7, current_date, null); -- no debe lanzar

  -- #5 — chofer_privado_permitir_transporte: abogado (no admin/flota-elevado) → 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', v_abogado, 'role', 'authenticated')::text, true);
  begin
    perform sgc.chofer_privado_permitir_transporte(v_chofer, true, null);
    raise exception 'FAIL #5: abogado pudo usar el interruptor de chofer privado';
  exception when sqlstate '42501' then null;
  end;

  raise notice 'OK — 5 asserts de permisos negativos pasaron (conduces_huerfanos, reporte_rendimiento_vehiculos, interruptor).';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-cw-permisos-negativos OK (rollback, nada quedó guardado)');
