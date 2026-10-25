// smoke-cx1-admin-claude-filtros.mjs — CX1: confirma que la nueva firma de
// claude_llamadas_recientes (filtros + paginación) sigue siendo admin-only, que
// el filtro solo_error funciona, y que claude_llamadas_filtros_disponibles
// también está protegida. Transaccional, ROLLBACK, no persiste nada.
//
//   node scripts/smoke-cx1-admin-claude-filtros.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_normal uuid := gen_random_uuid();
  v_admin uuid;
  v_otro uuid := gen_random_uuid();
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin is null then raise exception 'Falta un usuario admin de prueba en este entorno'; end if;

  insert into auth.users (id) values (v_normal), (v_otro);
  insert into sgc.usuarios (id, nombre, email, activo) values
    (v_normal, 'Smoke CX1 normal', 'smoke-cx1-normal@dev.constructorasd.local', true),
    (v_otro, 'Smoke CX1 otro', 'smoke-cx1-otro@dev.constructorasd.local', true);

  -- Dos llamadas sembradas directo en la tabla: una OK de v_otro, una con error de v_normal.
  insert into sgc.claude_llamadas (usuario_id, herramienta, ok, error, creado_en)
  values (v_otro, 'smoke_tool_ok', true, null, now()),
         (v_normal, 'smoke_tool_error', false, 'Falta el parámetro obligatorio smoke.', now());

  -- #1 — usuario normal → 42501 en ambas RPCs nuevas.
  perform set_config('request.jwt.claims', json_build_object('sub', v_normal, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform sgc.claude_llamadas_recientes(20, false, null, null, 0);
    raise exception 'FAIL #1: un usuario normal pudo leer claude_llamadas_recientes';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform sgc.claude_llamadas_filtros_disponibles();
    raise exception 'FAIL #1b: un usuario normal pudo leer claude_llamadas_filtros_disponibles';
  exception when sqlstate '42501' then null;
  end;

  -- #2 — admin SÍ puede, y p_solo_error=true solo trae la fila con error.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  if exists (
    select 1 from sgc.claude_llamadas_recientes(50, true, null, null, 0) where herramienta = 'smoke_tool_ok'
  ) then
    raise exception 'FAIL #2: p_solo_error=true trajo una llamada OK';
  end if;
  if not exists (
    select 1 from sgc.claude_llamadas_recientes(50, true, null, null, 0) where herramienta = 'smoke_tool_error' and error = 'Falta el parámetro obligatorio smoke.'
  ) then
    raise exception 'FAIL #2b: p_solo_error=true no trajo la llamada con error esperada (con su texto)';
  end if;

  -- #3 — p_herramienta filtra por nombre exacto.
  if exists (
    select 1 from sgc.claude_llamadas_recientes(50, false, 'smoke_tool_error', null, 0) where herramienta <> 'smoke_tool_error'
  ) then
    raise exception 'FAIL #3: p_herramienta no filtró correctamente';
  end if;

  -- #4 — compatibilidad: llamar solo con p_limite (como hacía la pantalla antes
  -- de esta ronda) sigue funcionando sin ambigüedad de overload.
  perform sgc.claude_llamadas_recientes(5);

  raise notice 'OK — 4 asserts de CX1 pasaron (admin-only, filtro de error, filtro de herramienta, compat con la firma vieja).';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-cx1-admin-claude-filtros OK (rollback, nada quedó guardado)');
