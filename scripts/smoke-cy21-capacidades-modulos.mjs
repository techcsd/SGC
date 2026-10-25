// CY21 punto 3 -- smoke transaccional (ROLLBACK) de capacidades_asistente()
// dinamica: toma un usuario real de dev, le agrega TEMPORALMENTE (dentro de
// la transaccion, nunca persiste) un rol sintetico con el modulo 'reuniones'
// (uno de los 5 que faltaban en la lista fija: reuniones/ingenieria/obra/
// transporte/plataforma) y confirma que capacidades_asistente() lo refleja
// sin perder los modulos que ya tenia.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_usuario_id uuid;
  v_rol_id integer;
  v_antes jsonb;
  v_despues jsonb;
begin
  select ur.usuario_id into v_usuario_id
    from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
   where 'inventario' = any(r.modulos) and not ('reuniones' = any(r.modulos))
   limit 1;
  if v_usuario_id is null then
    raise exception 'FALLO_SETUP: no hay usuario de prueba con inventario y sin reuniones';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_id::text, 'role','authenticated')::text, true);
  set local role authenticated;
  v_antes := sgc.capacidades_asistente();
  reset role;

  if (v_antes->'modulos' ? 'reuniones') then
    raise exception 'FALLO_SETUP: el usuario ya veia reuniones antes del cambio -- %', v_antes;
  end if;
  if not (v_antes->'modulos' ? 'inventario') then
    raise exception 'FALLO_SETUP: el usuario no veia inventario antes del cambio -- %', v_antes;
  end if;

  insert into sgc.roles (codigo, nombre, modulos) values ('cy21_smoke_reuniones', 'CY21 Smoke Reuniones', array['reuniones'])
    returning id into v_rol_id;
  insert into sgc.usuarios_roles (usuario_id, rol_id) values (v_usuario_id, v_rol_id);

  set local role authenticated;
  v_despues := sgc.capacidades_asistente();
  reset role;

  if not (v_despues->'modulos' ? 'reuniones') then
    raise exception 'FALLO: tras el rol sintetico, modulos no incluye reuniones -- %', v_despues;
  end if;
  if not (v_despues->'modulos' ? 'inventario') then
    raise exception 'FALLO: se perdio inventario al agregar el rol sintetico -- %', v_despues;
  end if;

  raise notice 'OK antes=% despues=%', v_antes, v_despues;
  raise exception 'ROLLBACK_SMOKE_OK';
exception when others then
  if sqlerrm <> 'ROLLBACK_SMOKE_OK' then raise; end if;
end $$;
rollback;
`;

try {
  await dbQuery(env, sql);
  console.log('✓ capacidades_asistente() dinámica: reuniones aparece, inventario se conserva (ROLLBACK limpio)');
  process.exit(0);
} catch (e) {
  console.log('✗ smoke capacidades_asistente dinámica:', e.message.slice(0, 600));
  process.exit(1);
}
