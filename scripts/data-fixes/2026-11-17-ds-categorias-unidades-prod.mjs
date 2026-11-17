// 2026-11-17 -- DS-07 en PROD: vincula categorias y unidades de SGC con sus equivalentes EXACTAS del Odoo real (1:1, validando el nombre
// en Odoo antes). Solo equivalencias claras; el resto queda sin vincular. Delegado por Xaviel (17-nov, "haz todo lo pendiente").
//   node scripts/data-fixes/2026-11-17-ds-categorias-unidades-prod.mjs --env prod --yes [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const apply = argv.includes('--apply');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const { kw } = await conectar();
const [inst] = await consulta(env, "select id from sgc.odoo_instancias where habilitada and entorno='prod'");
const CAT = { 'EPP (Equipos de Protección Personal)': [8, 'EPP'], 'Madera': [5, 'MADERA'], 'Equipos de Apuntalamiento': [4, 'EQUIPOS PARA APUNTALAMIENTOS'], 'Moldes y Accesorios': [18, 'MOLDES Y ACCESORIOS SD'],
  'Material de Oficina': [23, 'SUMINISTROS DE OFICINA'], 'Materiales Consumibles': [7, 'MATERIALES CONSUMIBLES'], 'Equipos y Herramientas': [10, 'HERRAMIENTAS'] };
const UNI = { unidad: [1, 'Units'], paquete: [54, 'PAQUETE'], par: [63, 'Par'], funda: [56, 'FUNDA'], caja: [65, 'Caja'], rollo: [66, 'Rollo'], docena: [2, 'Dozens'], galon: [59, 'Gl'],
  kg: [12, 'kg'], lb: [15, 'lb'], litro: [10, 'L'], m: [5, 'm'], m2: [9, 'm²'], pie: [30, 'Pies'], pie2: [21, 'ft²'], yarda: [19, 'yd'], tonelada: [14, 't'], pulgada: [17, 'in'] };
let n = 0;
for (const [nombre, [id, odooNombre]] of Object.entries(CAT)) {
  const [c] = await kw('product.category', 'read', [[id]], { fields: ['name'] }); if (c?.name !== odooNombre) { console.log(`  ! categoria ${id} no coincide`); continue; }
  console.log(`  cat ${nombre} -> ${id}`); n++;
  if (apply) await consulta(env, `update sgc.categorias_inventario set odoo_instancia_id=${lit(inst.id)}, odoo_id=${id}, odoo_ultima_sync=now() where nombre=${lit(nombre)} and odoo_id is null`);
}
for (const [codigo, [id, odooNombre]] of Object.entries(UNI)) {
  const [u] = await kw('uom.uom', 'read', [[id]], { fields: ['name'] }); if (u?.name !== odooNombre) { console.log(`  ! unidad ${id} no coincide`); continue; }
  console.log(`  uni ${codigo} -> ${id}`); n++;
  if (apply) await consulta(env, `update sgc.unidades set odoo_instancia_id=${lit(inst.id)}, odoo_id=${id}, odoo_ultima_sync=now() where codigo=${lit(codigo)} and odoo_id is null`);
}
console.log(`${apply ? 'vinculados' : 'dry-run'}: ${n}`);
if (apply) console.log(JSON.stringify([await consulta(env, 'select count(*) filter (where odoo_id is not null) v, count(*) t from sgc.categorias_inventario'), await consulta(env, 'select count(*) filter (where odoo_id is not null) v, count(*) t from sgc.unidades')]));
