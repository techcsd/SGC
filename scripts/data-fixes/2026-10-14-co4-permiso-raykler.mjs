// scripts/data-fixes/2026-10-14-co4-permiso-raykler.mjs — PROMPT-98 F2 (CO4)
// Da a Raykler Peña el permiso `requisicion_autoaprobar` (#214).
//
//   node scripts/data-fixes/2026-10-14-co4-permiso-raykler.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-14-co4-permiso-raykler.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-14-co4-permiso-raykler.mjs --env prod --apply --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

const candidatos = await dbQuery(env, `
  select id, nombre, cedula, email from sgc.usuarios where nombre ilike '%raykler%pe%a%' or nombre ilike '%raykler%'`);

if (candidatos.length !== 1) {
  console.error(`🔴 Se esperaba exactamente 1 "Raykler Peña", se encontraron ${candidatos.length}:`);
  console.error(candidatos.map((c) => `  ${c.id}  ${c.nombre}  ${c.email ?? '—'}`).join('\n'));
  process.exit(1);
}
const raykler = candidatos[0];
console.log(`Candidato único: ${raykler.nombre} (${raykler.id}, ${raykler.email ?? 'sin email'})`);

const [admin] = await dbQuery(env, `
  select u.id from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where r.codigo = 'admin' and u.nombre ilike 'Xaviel%'
  order by u.created_at asc limit 1`);

const [existente] = await dbQuery(env, `
  select activo from sgc.usuario_permisos_extra
  where usuario_id = '${raykler.id}'::uuid and permiso = 'requisicion_autoaprobar'`);
console.log(`Estado actual: ${existente ? (existente.activo ? 'ya tiene el permiso' : 'tenía el permiso pero revocado') : 'sin permiso'}`);

if (APPLY) {
  await dbQuery(env, `
    select set_config('request.jwt.claims', json_build_object('sub','${admin.id}','role','authenticated')::text, true);
    select set_config('role','authenticated', true);
    select sgc.otorgar_permiso_extra('${raykler.id}'::uuid, 'requisicion_autoaprobar', 'CO4 — #214, pidió poder aprobar sus propias requisiciones (Coordinador de Compras/Jefe de Flota/Logística)');
  `);
  console.log('✅ permiso otorgado.');
} else {
  console.log('(dry-run) usa --apply para otorgar.');
}
