// CZ4 -- smoke transaccional (ROLLBACK) del rol Subadministrador.
// Cubre: es_subadmin()=true y is_admin()=false para el rol; el permiso
// granular 'tecnologia.inventario'/'tecnologia.compras' le abre tec_equipos y
// crear_solicitud_compra_tec SIN el modulo 'tecnologia'; y que alguien SIN el
// rol ni el modulo sigue sin acceso (regresion).
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_sub_id uuid;
  v_ajeno_id uuid;
  v_proyecto_id uuid;
  v_equipo_id uuid;
  v_sol_id uuid;
  v_is_admin boolean;
  v_is_sub boolean;
begin
  -- Reusa 2 usuarios REALES de dev (sgc.usuarios.id es FK a auth.users, no se
  -- puede insertar uno sintético) sin ningún acceso previo a tecnologia/admin;
  -- a uno se le agrega el rol subadmin SOLO dentro de esta transacción
  -- (ROLLBACK al final, nunca se persiste).
  select u.id into v_sub_id
  from sgc.usuarios u
  where exists (select 1 from sgc.usuarios_roles ur3 where ur3.usuario_id = u.id)
    and not exists (
      select 1 from sgc.usuarios_roles ur2 join sgc.roles r2 on r2.id = ur2.rol_id
      where ur2.usuario_id = u.id and (
        'tecnologia' = any(r2.modulos) or r2.codigo in ('admin', 'subadmin')
        or coalesce(r2.permisos->>'tecnologia.inventario', '') <> ''
        or coalesce(r2.permisos->>'tecnologia.compras', '') <> ''
      )
    )
  limit 1;
  if v_sub_id is null then raise exception 'FALLO_SETUP: no hay usuario real sin tecnologia/admin/subadmin/granulares para probar subadmin'; end if;
  insert into sgc.usuarios_roles (usuario_id, rol_id)
    select v_sub_id, id from sgc.roles where codigo = 'subadmin';

  select u.id into v_ajeno_id
  from sgc.usuarios u
  where u.id <> v_sub_id
    and exists (select 1 from sgc.usuarios_roles ur3 where ur3.usuario_id = u.id)
    and not exists (
      select 1 from sgc.usuarios_roles ur2 join sgc.roles r2 on r2.id = ur2.rol_id
      where ur2.usuario_id = u.id and (
        'tecnologia' = any(r2.modulos) or r2.codigo in ('admin', 'subadmin')
        or coalesce(r2.permisos->>'tecnologia.inventario', '') <> ''
        or coalesce(r2.permisos->>'tecnologia.compras', '') <> ''
      )
    )
  limit 1;
  if v_ajeno_id is null then raise exception 'FALLO_SETUP: no hay usuario ajeno sin tecnologia/admin/subadmin/granulares'; end if;

  select id into v_proyecto_id from sgc.proyectos limit 1;

  -- ── es_subadmin()=true, is_admin()=false ───────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_sub_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_is_admin := sgc.is_admin();
  v_is_sub := sgc.es_subadmin();
  reset role;
  if v_is_admin then raise exception 'FALLO: el Subadministrador NO debe ser is_admin()'; end if;
  if not v_is_sub then raise exception 'FALLO: es_subadmin() deberia ser true'; end if;
  raise notice 'OK: es_subadmin()=true, is_admin()=false';

  -- ── Subadmin: crea equipo de inventario TI (permiso granular, sin modulo tecnologia) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_sub_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into sgc.tec_equipos (nombre, tipo) values ('CZ4-SMOKE equipo', 'laptop') returning id into v_equipo_id;
  if v_equipo_id is null then raise exception 'FALLO: subadmin no pudo crear un tec_equipo'; end if;
  reset role;
  raise notice 'OK: subadmin crea tec_equipos (permiso granular tecnologia.inventario)';

  -- ── Subadmin: crea una compra tecnológica (permiso granular, sin módulo) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_sub_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_sol_id := sgc.crear_solicitud_compra_tec('CZ4-SMOKE compra', '[]'::jsonb, 'CZ4-SMOKE', 'normal', v_proyecto_id, false);
  reset role;
  if v_sol_id is null then raise exception 'FALLO: subadmin no pudo crear una compra tecnologica'; end if;
  raise notice 'OK: subadmin crea compras tecnologicas (permiso granular tecnologia.compras)';

  -- ── Subadmin: ve y opera Cotizaciones (CZ1) ──────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_sub_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  perform sgc.cotizacion_crear('CZ4-SMOKE cotizacion', null, null, 'DOP', null, null, null, null, null, null, null);
  reset role;
  raise notice 'OK: subadmin opera Cotizaciones (tecnologia.cotizaciones)';

  -- ── Regresión: alguien SIN rol/módulo/permiso sigue sin acceso a tec_equipos ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_ajeno_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from sgc.tec_equipos where id = v_equipo_id) then
    raise exception 'FALLO: un usuario ajeno pudo VER el tec_equipo (RLS CZ4 demasiado abierta)';
  end if;
  begin
    perform sgc.crear_solicitud_compra_tec('no deberia', '[]'::jsonb, null, 'normal', null, false);
    raise exception 'FALLO: un usuario ajeno pudo crear una compra tecnologica';
  exception when others then
    if sqlerrm like '%No autorizado%' then raise notice 'OK: crear_solicitud_compra_tec sigue negando a quien no tiene tecnologia/subadmin'; else raise; end if;
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
  console.log('✓ CZ4: es_subadmin()=true/is_admin()=false, permisos granulares abren tec_equipos y crear_solicitud_compra_tec sin el módulo tecnologia, Cotizaciones operable, regresión (ajeno sin acceso) OK (ROLLBACK limpio)');
} catch (e) {
  console.log('✗ CZ4 smoke falló:', e.message.slice(0, 2000));
  process.exit(1);
}
