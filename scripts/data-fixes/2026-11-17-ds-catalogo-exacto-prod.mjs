// 2026-11-17 -- Vincula en PROD los articulos de SGC sin vinculo cuyo nombre normalizado coincide EXACTO y UNICO con un product.product
// activo del Odoo real que ningun otro articulo usa. Delegado por Xaviel (17-nov). Lo ambiguo o sin coincidencia NO se toca
// (requiere crear el producto en Odoo o decidirlo a mano).
//   node scripts/data-fixes/2026-11-17-ds-catalogo-exacto-prod.mjs --env prod --yes [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const apply = argv.includes('--apply');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const { kw } = await conectar();
const [inst] = await consulta(env, "select id from sgc.odoo_instancias where habilitada and entorno='prod'");
const sgc = await consulta(env, 'select id, nombre from sgc.articulos where activo and odoo_product_id is null');
const od = await kw('product.product', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'product_tmpl_id'], limit: 5000 });
const m = new Map(); for (const p of od) { const k = norm(p.name); (m.get(k) ?? m.set(k, []).get(k)).push(p); }
const ya = new Set((await consulta(env, 'select odoo_product_id from sgc.articulos where odoo_product_id is not null')).map((r) => Number(r.odoo_product_id)));
const nombres = new Map(); for (const a of sgc) nombres.set(norm(a.nombre), (nombres.get(norm(a.nombre)) ?? 0) + 1);
let n = 0;
for (const a of sgc) {
  const c = m.get(norm(a.nombre));
  if (!c || c.length !== 1 || ya.has(c[0].id) || nombres.get(norm(a.nombre)) !== 1) continue;
  n++; console.log(`  ${a.nombre} -> ${c[0].id}`);
  if (apply) await consulta(env, `update sgc.articulos set odoo_instancia_id=${lit(inst.id)}, odoo_product_id=${c[0].id}, odoo_template_id=${c[0].product_tmpl_id[0]}, odoo_ultima_sync=now() where id=${lit(a.id)} and odoo_product_id is null`);
}
console.log(`${apply ? 'vinculados' : 'dry-run'}: ${n}`);
