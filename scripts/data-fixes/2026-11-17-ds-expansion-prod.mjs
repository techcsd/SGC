// 2026-11-17 -- Enciende la fase EXPANSION en PROD (autorizado por Xaviel, 17-nov: "enciende la expansion ... no dejes nada en mock").
// Requiere canary encendido. Apagar: --apagar (solo expansion; canary queda).
//   node scripts/data-fixes/2026-11-17-ds-expansion-prod.mjs --env prod --yes [--apply | --apagar]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const [admin] = await sql(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre='Xaviel Terrero' limit 1`);
const claims = JSON.stringify({ sub: admin.id, role: 'authenticated' });
const on = !argv.includes('--apagar');
console.log(JSON.stringify(await sql(`select clave, habilitada from sgc.odoo_fases order by clave`)));
if (!argv.includes('--apply') && on) { console.log('dry-run (usa --apply)'); process.exit(0); }
await sql(`select set_config('request.jwt.claims', ${lit(claims)}, true); select sgc.odoo_fase_set('expansion', ${on});`);
console.log(JSON.stringify(await sql(`select clave, habilitada from sgc.odoo_fases order by clave`)));
