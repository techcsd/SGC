// 2026-11-17 -- Primer conduce REAL del canary en PROD (WH -> TA, 1 unidad de un articulo piloto), autorizado por Xaviel (17-nov).
// Crea el conduce como Xaviel, espera al worker (cron), verifica el traslado A en el Odoo real; (el B no se prueba: exige evidencia fotografica real);
// al final lo ANULA (devoluciones -D) para dejar el Odoo neto en cero. Cada paso se imprime.
//   node scripts/data-fixes/2026-11-17-ds-canary-conduce-prod.mjs --env prod --yes [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const apply = argv.includes('--apply');
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const [admin] = await sql(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre='Xaviel Terrero' limit 1`);
const [WH] = await sql(`select id from sgc.bodegas where codigo_odoo='WH'`);
const [TA] = await sql(`select id from sgc.bodegas where codigo_odoo='TA'`);
const [fase] = await sql(`select config from sgc.odoo_fases where clave='canary' and habilitada`);
if (!admin || !WH || !TA || !fase) throw new Error('Falta admin, bodegas WH/TA o fase canary encendida.');
const piloto = fase.config.articulos_piloto;
const [art] = await sql(`select a.id, a.nombre, a.odoo_product_id p, s.cantidad::float c from sgc.articulos a join sgc.stock_por_bodega s on s.articulo_id=a.id where s.bodega_id=${lit(WH.id)} and a.id = any(${lit(`{${piloto.join(',')}}`)}::uuid[]) order by s.cantidad desc limit 1`);
console.log(`articulo piloto: ${art.nombre} (stock SGC en WH: ${art.c}); 1 unidad WH->TA`);
if (!apply) { console.log('dry-run (usa --apply)'); process.exit(0); }

const claims = JSON.stringify({ sub: admin.id, role: 'authenticated' });
const as = (q) => sql(`select set_config('request.jwt.claims', ${lit(claims)}, true); ${q}`);
const { kw } = await conectar();
const id = argv.includes('--solo-anular') ? argv[argv.indexOf('--solo-anular') + 1] : crypto.randomUUID();
const its = JSON.stringify([{ articulo_id: art.id, cantidad: 1 }]);
if (!argv.includes('--solo-anular')) await as(`select sgc.crear_conduce_simple(${lit(id)}, current_date, ${lit(WH.id)}, null, 'Validacion canary Odoo (Tecnologia)', null, null, ${lit(its)}::jsonb, 'Tecnologia', null, null, null, null, null, ${lit(TA.id)}::uuid)::text`);
console.log('conduce creado:', id);
const picks = async () => kw('stock.picking', 'search_read', [[['origin', 'like', `SGC-TRAS-${id}`]]], { fields: ['origin', 'state'], context: { active_test: false } });
const esperar = async (cond, etiqueta) => { for (let i = 0; i < 24; i++) { await dormir(10000); const p = await picks(); const e = (await sql(`select odoo_sync_estado e, odoo_sync_error er from sgc.salidas_inventario where id=${lit(id)}`))[0]; if (cond(p, e)) { console.log(etiqueta, JSON.stringify({ p, e })); return true; } } console.log('TIMEOUT', etiqueta, JSON.stringify(await picks())); return false; };
let ok = await esperar((p, e) => p.some((x) => x.origin.endsWith('-A') && x.state === 'done') && e.e === 'sincronizado', 'A validado');
// El paso B (entregar) exige foto de evidencia real: no se fabrica; se valida solo A y se revierte.
console.log('--- anulando para dejar el Odoo neto en cero');
await as(`select sgc.anular_conduce(${lit(id)}, 'Validacion canary: se revierte')`).catch((e) => console.log('anular:', e.message));
await esperar((p) => p.some((x) => /-D\d+$/.test(x.origin) && x.state === 'done'), 'devoluciones');
console.log('conciliador:', JSON.stringify(await sql(`select estado, resumen from sgc.odoo_conciliacion_corridas order by creado_en desc limit 1`).catch(() => [])));
