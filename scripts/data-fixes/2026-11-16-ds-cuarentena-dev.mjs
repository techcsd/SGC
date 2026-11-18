// 2026-11-16 DS-21 -- enlaza bodegas.odoo_cuarentena_location_id con la ubicacion «Cuarentena SGC <codigo>» de Odoo STAGING, en DEV.
// Los ids se resuelven en vivo contra staging por nombre + padre (vista del almacen); no se copia ningun id al repo.
// Dry-run por defecto; --apply escribe solo en dev.  Requiere haber corrido scripts/odoo-cuarentena-staging.mjs.
//   node scripts/data-fixes/2026-11-16-ds-cuarentena-dev.mjs --env dev [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev (staging de Odoo).'); process.exit(1); }
const apply = argv.includes('--apply');
const { kw } = await conectar();
const bodegas = await consulta(env, `select id, nombre, codigo_odoo_raw as codigo, odoo_warehouse_id as wh, odoo_cuarentena_location_id as cuar from sgc.bodegas where codigo_odoo is not null and odoo_warehouse_id is not null`);
const whs = await kw('stock.warehouse', 'search_read', [[['id', 'in', bodegas.map((b) => b.wh)]]], { fields: ['id', 'code', 'view_location_id'] });
let enlazadas = 0, ya = 0, faltan = [];
for (const b of bodegas) {
  const w = whs.find((x) => x.id === b.wh);
  const locs = w ? await kw('stock.location', 'search_read', [[['name', '=', `Cuarentena SGC ${w.code}`], ['location_id', '=', w.view_location_id[0]], ['usage', '=', 'internal']]], { fields: ['id'] }) : [];
  if (locs.length !== 1) { faltan.push(b.codigo); continue; }
  if (Number(b.cuar) === locs[0].id) { ya++; continue; }
  console.log(`  + ${b.nombre} -> Cuarentena SGC ${w.code}`);
  if (apply) await consulta(env, `update sgc.bodegas set odoo_cuarentena_location_id=${locs[0].id} where id='${b.id}'`);
  enlazadas++;
}
console.log(`${apply ? 'APLICADO' : 'dry-run'}: ${enlazadas} por enlazar/enlazadas, ${ya} ya enlazadas, sin ubicacion unica: ${faltan.join(', ') || 'ninguna'}`);
