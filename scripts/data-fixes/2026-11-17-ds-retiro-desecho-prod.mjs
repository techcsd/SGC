// 2026-11-17 -- Prueba REAL en PROD del circuito Desechar/cuarentena (retiro de material -> Odoo), autorizada por Xaviel (17-nov).
// Usa 1 unidad de TIES 25CM en TA (misma bodega de obra y de cuarentena). --disp reparacion: TA->cuarentena->TA (neto cero).
// --disp descarte: TA->cuarentena->desecho (-1 real) y se repone con un conteo +1 (neto cero). Imprime cada paso.
//   node scripts/data-fixes/2026-11-17-ds-retiro-desecho-prod.mjs --env prod --yes --disp reparacion|descarte [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const disp = argv[argv.indexOf('--disp') + 1];
if (!['reparacion', 'descarte'].includes(disp)) throw new Error('--disp reparacion|descarte');
const apply = argv.includes('--apply');
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const [admin] = await sql(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre='Xaviel Terrero' limit 1`);
const [TA] = await sql(`select id, proyecto_id, odoo_location_id loc, odoo_cuarentena_location_id cuar from sgc.bodegas where codigo_odoo='TA'`);
const [art] = await sql(`select a.id, a.nombre, a.odoo_product_id p from sgc.articulos a where a.nombre ilike 'TIES 25CM%' and a.odoo_product_id is not null limit 1`);
console.log('obra/bodega TA proyecto:', TA.proyecto_id, '| articulo:', art.nombre, '| disposicion:', disp);
if (!apply) { console.log('dry-run (usa --apply)'); process.exit(0); }
const claims = JSON.stringify({ sub: admin.id, role: 'authenticated' });
const as = (q) => sql(`select set_config('request.jwt.claims', ${lit(claims)}, true); ${q}`);
const { kw } = await conectar();
const quant = async (loc) => (await kw('stock.quant', 'search_read', [[['location_id', '=', loc], ['product_id', '=', art.p]]], { fields: ['quantity'] })).reduce((s, x) => s + x.quantity, 0);
const antes = { ta: await quant(TA.loc), cuar: await quant(TA.cuar) }; console.log('Odoo antes:', JSON.stringify(antes));
const items = JSON.stringify([{ articulo_id: art.id, cantidad: 1, descripcion: art.nombre, unidad: 'UD' }]);
const fotos = JSON.stringify([{ path: 'validacion/odoo-desecho.png', nombre: 'validacion Odoo' }]);
const [{ id }] = await as(`select sgc.crear_retiro_material(${lit(TA.proyecto_id)}, ${lit(TA.id)}, 'otro', 'Validacion Odoo (Tecnologia): NO es un retiro real', null, ${lit(items)}::jsonb, ${lit(fotos)}::jsonb, false) as id`);
console.log('retiro', id);
await as(`select sgc.retiro_aprobar(${lit(id)}, ${lit(TA.id)})`);
await as(`select sgc.retiro_recibir(${lit(id)}, 'validacion/foto.png', 'validacion/firma.png', 'Validacion Odoo (Tecnologia)')`);
const esperar = async (cond, et) => { for (let i = 0; i < 30; i++) { await dormir(10000); const ev = await sql(`select estado, error, resultado from sgc.odoo_eventos where agregado_tipo='retiro_material' and agregado_id=${lit(id)} order by revision desc limit 1`); const st = { ta: await quant(TA.loc), cuar: await quant(TA.cuar) }; if (cond(ev[0], st)) { console.log(et, JSON.stringify({ ev: ev[0]?.estado, error: ev[0]?.error, st })); return true; } } console.log('TIMEOUT', et); return false; };
const ok1 = await esperar((e, s) => e?.estado === 'completado' && s.cuar === antes.cuar + 1, 'en cuarentena (Odoo)');
await as(`select sgc.retiro_disponer(${lit(id)}, ${lit(disp)}, 'Validacion Odoo (Tecnologia)')`);
const esperado = disp === 'reparacion' ? { ta: antes.ta, cuar: antes.cuar } : { ta: antes.ta - 1, cuar: antes.cuar };
const ok2 = await esperar((e, s) => e?.estado === 'completado' && e?.resultado?.disposicion === disp && s.ta === esperado.ta && s.cuar === esperado.cuar, `dispuesta ${disp} (Odoo)`);
console.log(ok1 && ok2 ? 'RETIRO OK' : 'RETIRO CON HALLAZGOS');
if (disp === 'descarte') console.log('Recuerda reponer 1 ud de TA con un conteo (el descarte fue real en Odoo).');
