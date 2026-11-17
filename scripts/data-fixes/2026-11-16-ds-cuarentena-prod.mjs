// 2026-11-16 DS-21 -- crea en el Odoo REAL una ubicacion de cuarentena por almacen vinculado y la enlaza en PROD.
// Autorizado por Xaviel (16-nov). Idempotente (busca por nombre + padre). Ids resueltos en vivo, ninguno en el repo.
// Nombre estandar «Cuarentena SGC <codigo>», usage internal, padre = vista del almacen (fuera del stock disponible).
//   node scripts/data-fixes/2026-11-16-ds-cuarentena-prod.mjs --env prod --yes [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
const apply = argv.includes('--apply');
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const { kw } = await conectar({ escritura: apply });
const bodegas = await consulta(env, `select id, nombre, odoo_warehouse_id as wh, odoo_cuarentena_location_id as cuar from sgc.bodegas where codigo_odoo is not null and odoo_warehouse_id is not null order by 2`);
const whs = await kw('stock.warehouse', 'search_read', [[['id', 'in', bodegas.map((b) => b.wh)]]], { fields: ['id', 'code', 'view_location_id', 'company_id'] });
let creadas = 0, ya = 0, enlazadas = 0;
for (const b of bodegas) {
  const w = whs.find((x) => x.id === b.wh); if (!w) { console.log('  ! sin almacen', b.nombre); continue; }
  const nombre = `Cuarentena SGC ${w.code}`;
  let ex = await kw('stock.location', 'search_read', [[['name', '=', nombre], ['location_id', '=', w.view_location_id[0]]]], { fields: ['id', 'active', 'usage'], context: { active_test: false } });
  if (!ex.length) {
    console.log(`  + crear ${nombre}`); creadas++;
    if (apply) { const id = await kw('stock.location', 'create', [{ name: nombre, usage: 'internal', location_id: w.view_location_id[0], company_id: w.company_id[0], scrap_location: false }]); ex = [{ id }]; }
  } else ya++;
  if (ex[0] && Number(b.cuar) !== ex[0].id) { enlazadas++; if (apply) await consulta(env, `update sgc.bodegas set odoo_cuarentena_location_id=${ex[0].id} where id='${b.id}'`); }
}
console.log(`${apply ? 'APLICADO' : 'dry-run'}: ${creadas} ubicaciones por crear/creadas, ${ya} ya existian, ${enlazadas} enlaces`);
