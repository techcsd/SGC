// smoke-conductor-acceso.mjs — BP1. Verifica que dar el rol chofer a un usuario
// sintético NO fabrica una ficha fantasma cuando la ficha del conductor tiene la
// cédula CON guiones. Ejercita el trigger `trg_usuarios_roles_asegura_conductor`
// (→ asegurar_conductor_de_usuario, migración 2026-09-14-bp1-asegurar-conductor-normalizado).
//
// Corre TODO dentro de una transacción y hace ROLLBACK: no deja nada en prod.
// Requiere que la migración 2026-09-14-bp1-asegurar-conductor-normalizado.sql ya
// esté aplicada (si no, el trigger viejo duplica y el smoke FALLA — que es el punto).
//
// Uso:  node scripts/smoke-conductor-acceso.mjs
// Env:  SUPABASE_ACCESS_TOKEN
const REF = process.env.SUPABASE_PROJECT_REF || 'jeeqhgccqefbqilntcpu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

const sql = `
begin;
do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_ced   text := '999-8887776-5';           -- CON guiones (el caso que rompía)
  v_norm  text := '99988877765';
  v_cond  uuid;
  v_rol   integer;
  v_count int;
  v_link  uuid;
begin
  select id into v_rol from sgc.roles where codigo = 'chofer_transportista';

  -- 1) Ficha del conductor con la cédula CON guiones, sin usuario.
  insert into sgc.conductores (cedula, nombre, licencia_tipo, tipo_vehiculo_autorizado, activo, es_prueba)
  values (v_ced, 'SMOKE BP1', '01', 'Liviano', true, true)
  returning id into v_cond;

  -- 2) Usuario auth sintético (email c-<digitos>@…) + perfil.
  insert into auth.users (id, email, email_confirmed_at, created_at, updated_at, aud, role)
  values (v_uid, 'c-'||v_norm||'@conductores.constructorasd.local', now(), now(), now(), 'authenticated', 'authenticated');
  insert into sgc.usuarios (id, nombre, email, activo) values (v_uid, 'SMOKE BP1', 'c-'||v_norm||'@conductores.constructorasd.local', true);

  -- 3) NO enlazamos la ficha (simula el orden viejo de la edge: rol antes de enlace).
  --    Asignar el rol dispara el trigger → asegurar_conductor_de_usuario.
  insert into sgc.usuarios_roles (usuario_id, rol_id) values (v_uid, v_rol);

  -- 4) Aserciones: debe haber UNA sola ficha para esa cédula normalizada, y debe ser
  --    la original (enlazada al usuario). Con el trigger VIEJO habría DOS.
  select count(*) into v_count from sgc.conductores
    where regexp_replace(cedula,'\\D','','g') = v_norm;
  if v_count <> 1 then
    raise exception 'SMOKE BP1 FALLA: hay % fichas para la cédula % (esperado 1 = sin fantasma).', v_count, v_norm;
  end if;
  select usuario_id into v_link from sgc.conductores where id = v_cond;
  if v_link is distinct from v_uid then
    raise exception 'SMOKE BP1 FALLA: la ficha original no quedó enlazada al usuario (usuario_id=%).', v_link;
  end if;

  raise notice 'SMOKE BP1 OK: 1 ficha, enlazada a la original, sin fantasma.';
end $$;
rollback;
`;

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,
  { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
const text = await res.text();
if (!res.ok) { console.error(`🔴 SMOKE BP1 FALLA\nHTTP ${res.status}\n${text}`); process.exit(1); }
console.log('✓ smoke-conductor-acceso: trigger no fabrica fantasma (cédula con guiones).');
