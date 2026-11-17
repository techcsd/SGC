// 2026-11-17 -- Cierra el hallazgo fuera_de_canal del picking 871 (picking de prueba cancelado de 8-nov, no es deriva; el conciliador ya lo ignora).
//   node scripts/data-fixes/2026-11-17-ds-cerrar-hallazgo-871-prod.mjs --env prod --yes
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
await consulta(env, "update sgc.odoo_discrepancias set resuelta_en = now() where clave = 'fuera_de_canal||871' and resuelta_en is null");
console.log(JSON.stringify(await consulta(env, 'select count(*) n from sgc.odoo_discrepancias where resuelta_en is null')));
