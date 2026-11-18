// 2026-11-17 -- Crea en el Odoo REAL los articulos de SGC que no tienen producto (almacenable, solo compra) y los vincula.
// Autorizado por Xaviel (17-nov: "hazlo"). Categoria/unidad por regla fija (abajo); idempotente (reusa por nombre exacto, incl. archivados).
// Reversa: archivar los product.product creados (active=false) y limpiar odoo_product_id/odoo_template_id de esos articulos.
//   node scripts/data-fixes/2026-11-17-ds-catalogo-crear-odoo-prod.mjs --env prod --yes [--apply]
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
// Ids de la instancia real (medidos 17-nov; se validan abajo por nombre antes de usarlos).
const CAT = { 'Moldes y Accesorios': [18, 'MOLDES Y ACCESORIOS SD'], 'Material de Oficina': [23, 'SUMINISTROS DE OFICINA'], 'Materia Prima (Madera, Palos, Plywood)': [5, 'MADERA'],
  'Equipos y Herramientas': [10, 'HERRAMIENTAS'], 'Equipos de Apuntalamiento': [4, 'EQUIPOS PARA APUNTALAMIENTOS'], 'EPP (Equipos de Protección Personal)': [8, 'EPP'] };
const CAT_DEF = [7, 'MATERIALES CONSUMIBLES']; // consumibles, estructurales, revision, otros
const UOM = { paquete: [54, 'PAQUETE'], par: [63, 'Par'], pie: [30, 'Pies'], galon: [59, 'Gl'], gl: [59, 'Gl'] };
const UOM_DEF = [1, 'Units'];
for (const [id, nombre] of [...Object.values(CAT), CAT_DEF]) { const [c] = await kw('product.category', 'read', [[id]], { fields: ['name'] }); if (c?.name !== nombre) throw new Error(`Categoria ${id} no coincide (${c?.name})`); }
for (const [id, nombre] of [...Object.values(UOM), UOM_DEF]) { const [u] = await kw('uom.uom', 'read', [[id]], { fields: ['name'] }); if (u?.name !== nombre) throw new Error(`Unidad ${id} no coincide (${u?.name})`); }
const arts = await consulta(env, 'select a.id, a.nombre, a.unidad, c.nombre cat from sgc.articulos a left join sgc.categorias_inventario c on c.id=a.categoria_id where a.activo and a.odoo_product_id is null order by a.nombre');
let creados = 0, reusados = 0;
for (const a of arts) {
  const categ = (CAT[a.cat] ?? CAT_DEF)[0]; const uom = (UOM[String(a.unidad ?? '').trim().toLowerCase()] ?? UOM_DEF)[0];
  if (!apply) { creados++; continue; }
  const ex = await kw('product.product', 'search_read', [[['name', '=', a.nombre]]], { fields: ['id', 'product_tmpl_id'], context: { active_test: false }, limit: 2 });
  let pid, tid;
  if (ex.length === 1) { pid = ex[0].id; tid = ex[0].product_tmpl_id[0]; reusados++; }
  else if (ex.length > 1) { console.log(`  ! ${a.nombre}: ${ex.length} productos con ese nombre, se omite`); continue; }
  else {
    pid = await kw('product.product', 'create', [{ name: a.nombre, detailed_type: 'product', categ_id: categ, uom_id: uom, uom_po_id: uom, purchase_ok: true, sale_ok: false }]);
    pid = Array.isArray(pid) ? pid[0] : pid;
    const [p] = await kw('product.product', 'read', [[pid]], { fields: ['product_tmpl_id'] }); tid = p.product_tmpl_id[0]; creados++;
  }
  await consulta(env, `update sgc.articulos set odoo_instancia_id=${lit(inst.id)}, odoo_product_id=${pid}, odoo_template_id=${tid}, odoo_ultima_sync=now() where id=${lit(a.id)} and odoo_product_id is null`);
}
console.log(`${apply ? 'creados' : 'dry-run (a crear)'}: ${creados}, reusados: ${reusados}, total candidatos: ${arts.length}`);
