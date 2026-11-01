// smoke-de3-badges.mjs — Ronda DE F4 (DE3/DE-07/DE-08): fuente unica de badges.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

async function comoUsuario(usuarioId, selectSql) {
  return dbQuery(env, `
    select set_config('request.jwt.claims', json_build_object('sub','${usuarioId}','role','authenticated')::text, true);
    select set_config('role', 'authenticated', true);
    ${selectSql}
  `);
}

let fallos = 0;
function check(nombre, cond, detalle) {
  if (!cond) { fallos++; console.log(`FAIL ${nombre}: ${detalle}`); }
  else console.log(`ok   ${nombre}`);
}

console.log('--- 1) función existe y corre sin error para un admin ---');
const admin = (await dbQuery(env, `select ur.usuario_id as id from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' limit 1;`))[0];
const r1 = await comoUsuario(admin.id, `select * from sgc.badges_modulos_app();`);
console.log(JSON.stringify(r1));
check('1 corre sin error', Array.isArray(r1), JSON.stringify(r1));

console.log('--- 2) ningún módulo con total=0 aparece (DE-08: 0 no es badge) ---');
check('2 sin ceros', r1.every((row) => row.total > 0), JSON.stringify(r1));

console.log('--- 3) inventario (si aparece) trae detalle.por_recibir + por_despachar ---');
const inv = r1.find((row) => row.modulo === 'inventario');
if (inv) {
  check('3a total = suma del detalle', inv.total === (inv.detalle.por_recibir + inv.detalle.por_despachar), JSON.stringify(inv));
} else {
  console.log('ok   3 (admin sin pendientes de inventario ahora mismo, no hay fila — correcto)');
}

console.log('--- 4) usuario sin ningún módulo/rol (sintético) no trae ninguna fila ---');
const nuevo = await dbQuery(env, `
  with u as (insert into auth.users (id) values (gen_random_uuid()) returning id)
  insert into sgc.usuarios (id, nombre, email, activo)
  select id, 'Smoke DE3 (sin nada)', 'smoke-de3@dev.constructorasd.local', true from u
  returning id;
`);
const nuevoId = nuevo[0].id;
try {
  // envuelto en count(*) para evitar la ambigüedad de un result-set vacío en
  // el harness del management API (ver nota arriba sobre el "último no-vacío").
  const r4 = await comoUsuario(nuevoId, `select count(*) as n from sgc.badges_modulos_app();`);
  check('4 sin filas para usuario sin nada', Number(r4[0]?.n) === 0, JSON.stringify(r4));
} finally {
  await dbQuery(env, `delete from sgc.usuarios where id='${nuevoId}';`);
  await dbQuery(env, `delete from auth.users where id='${nuevoId}';`);
}

console.log(fallos === 0 ? '\n✓ TODOS LOS CHECKS PASARON' : `\n✗ ${fallos} CHECK(S) FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
