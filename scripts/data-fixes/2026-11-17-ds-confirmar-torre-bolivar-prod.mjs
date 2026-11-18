// 2026-11-17 -- Confirma en PROD la cuenta analitica de PROY-0005 (Torre Bolivar -> 44 "TORRE BOLIVAR- APUNT.", unica candidata, existe en
// el Odoo real y tiene 2 lineas de compra). Decision delegada por Xaviel (17-nov: "decide tu"). Revertir: odoo_analitica_confirmar(id,false).
//   node scripts/data-fixes/2026-11-17-ds-confirmar-torre-bolivar-prod.mjs --env prod --yes
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const [admin] = await consulta(env, `select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre='Xaviel Terrero' limit 1`);
const [a] = await consulta(env, `select a.id from sgc.proyecto_odoo_analiticas a join sgc.proyectos p on p.id=a.proyecto_id where p.codigo='PROY-0005' and a.odoo_analytic_id=44 and not a.confirmado`);
if (!a) { console.log('nada que confirmar'); process.exit(0); }
await consulta(env, `update sgc.proyecto_odoo_analiticas set odoo_analytic_nombre='TORRE BOLIVAR- APUNT.' where id=${lit(a.id)} and odoo_analytic_nombre is null`);
await consulta(env, `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin.id, role: 'authenticated' }))}, true); select sgc.odoo_analitica_confirmar(${lit(a.id)}, true)`);
console.log(JSON.stringify(await consulta(env, `select confirmado from sgc.proyecto_odoo_analiticas where id=${lit(a.id)}`)));
