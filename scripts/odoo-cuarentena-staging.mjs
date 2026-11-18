// Crea en Odoo STAGING una ubicacion de cuarentena por almacen vinculado en SGC dev (DS-21). Idempotente, con guardia de host.
// Nombre estandar: «Cuarentena SGC <codigo de almacen>», usage internal, padre = vista del almacen. Nunca toca el Odoo real:
// exige que URL/BD de la cuenta de integracion identifiquen un staging y que el host no este en ODOO_HOSTS_PROD.
//   node scripts/odoo-cuarentena-staging.mjs --env dev [--apply] [--limpiar]   (--limpiar archiva las ubicaciones creadas)
import { resolverEnv } from './lib/entorno.mjs';
import { consulta } from './lib/dbq-dev.mjs';
import { conectar, hostStaging } from './lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev/staging.'); process.exit(1); }
const apply = argv.includes('--apply'); const limpiar = argv.includes('--limpiar');
const marca = `${process.env.SGC_INTEGRATION_ODOO_URL ?? ''} ${process.env.SGC_INTEGRATION_ODOO_DB ?? ''}`;
const prod = (process.env.ODOO_HOSTS_PROD ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!/stag/i.test(marca) || prod.includes(hostStaging().toLowerCase())) { console.error('Guardia: la cuenta de integracion no apunta a un staging reconocible. Abortado.'); process.exit(1); }
const { kw } = await conectar({ escritura: apply || limpiar });

const bodegas = await consulta(env, `select codigo_odoo_raw as codigo, odoo_warehouse_id as wh from sgc.bodegas where codigo_odoo is not null and odoo_warehouse_id is not null order by 1`);
const whs = await kw('stock.warehouse', 'search_read', [[['id', 'in', bodegas.map((b) => b.wh)]]], { fields: ['id', 'code', 'view_location_id', 'company_id'] });
let creadas = 0, ya = 0, archivadas = 0;
for (const w of whs) {
  const nombre = `Cuarentena SGC ${w.code}`;
  const ex = await kw('stock.location', 'search_read', [[['name', '=', nombre], ['location_id', '=', w.view_location_id[0]]]], { fields: ['id', 'active', 'usage'], context: { active_test: false } });
  if (limpiar) { for (const l of ex.filter((x) => x.active)) { if (apply) await kw('stock.location', 'write', [[l.id], { active: false }]); archivadas++; } continue; }
  if (ex.length) { if (!ex[0].active && apply) await kw('stock.location', 'write', [[ex[0].id], { active: true }]); ya++; continue; }
  console.log(`  + ${nombre}`);
  if (apply) await kw('stock.location', 'create', [{ name: nombre, usage: 'internal', location_id: w.view_location_id[0], company_id: w.company_id[0], scrap_location: false }]);
  creadas++;
}
console.log(`${apply ? 'APLICADO' : 'dry-run'}: ${creadas} por crear/creadas, ${ya} ya existian${limpiar ? `, ${archivadas} archivadas` : ''}`);
