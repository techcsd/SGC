// 2026-11-17 -- Carga en el Odoo REAL el costo (standard_price) de los productos CREADOS el 17-nov desde sgc.articulos.costo_promedio
// (solo los de ese lote, solo si costo > 0 y el costo en Odoo es 0). Prerrequisito de la apertura del corte (valoracion contable).
// Autorizado por Xaviel (17-nov). Reversa: standard_price = 0 en los mismos productos.
//   node scripts/data-fixes/2026-11-17-ds-costos-catalogo-prod.mjs --env prod --yes [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const apply = argv.includes('--apply');
const { kw } = await conectar();
// Lote = productos que el script ds-catalogo-crear-odoo-prod creo (create_date de hoy y create_uid de la cuenta de integracion).
const arts = await consulta(env, 'select id, nombre, odoo_product_id p, costo_promedio::float c from sgc.articulos where activo and odoo_product_id is not null and coalesce(costo_promedio,0) > 0');
const ids = arts.map((a) => Number(a.p));
const prods = await kw('product.product', 'search_read', [[['id', 'in', ids], ['create_date', '>=', '2026-11-17 00:00:00'], ['standard_price', '=', 0]]], { fields: ['id', 'name'], limit: 1000 });
const costo = new Map(arts.map((a) => [Number(a.p), a.c]));
console.log(`${apply ? 'actualizando' : 'dry-run'}: ${prods.length} productos del lote con costo SGC > 0 (de ${arts.length} con costo)`);
for (const p of prods) if (apply) await kw('product.product', 'write', [[p.id], { standard_price: costo.get(p.id) }]);
console.log('listo');
