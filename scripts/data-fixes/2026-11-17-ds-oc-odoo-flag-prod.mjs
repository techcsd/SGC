// 2026-11-17 -- Enciende en PROD el selector de productos Odoo en "crear OC" (odoo_compras_piloto_habilitado=true). Autorizado por Xaviel
// (17-nov: "no dejes nada en mock", OC de prueba "Prueba XT"). Apagar: --apagar.
//   node scripts/data-fixes/2026-11-17-ds-oc-odoo-flag-prod.mjs --env prod --yes [--apagar]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
await consulta(env, `update sgc.parametros set valor='${argv.includes('--apagar') ? 'false' : 'true'}' where clave='odoo_compras_piloto_habilitado'`);
console.log(JSON.stringify(await consulta(env, `select sgc.odoo_compras_piloto_habilitado() v`)));
