// 2026-11-17 -- Prueba REAL en PROD del circuito de Ajustes (conteo fisico -> Odoo), autorizada por Xaviel (17-nov): sube +1 un articulo
// piloto en WH, verifica el quant en el Odoo real, deshace (compensacion) y verifica que el Odoo vuelve al saldo original. Neto cero.
//   node scripts/data-fixes/2026-11-17-ds-ajustes-conteo-prod.mjs --env prod --yes [--apply]
//   --reponer TA : sube +1 un articulo (--nombre, --objetivo opcional) en esa bodega SIN deshacer (repone el descarte real de la prueba de desecho).
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
const [WH] = await sql(`select id, odoo_location_id loc from sgc.bodegas where codigo_odoo=${lit(argv.includes('--reponer') ? argv[argv.indexOf('--reponer') + 1] : 'WH')}`);
const [art] = await sql(`select a.id, a.nombre, a.odoo_product_id p, s.cantidad::float c from sgc.articulos a join sgc.stock_por_bodega s on s.articulo_id=a.id where s.bodega_id=${lit(WH.id)} and a.odoo_product_id is not null and ${argv.includes('--nombre') ? `a.nombre = ${lit(argv[argv.indexOf('--nombre') + 1])}` : 's.cantidad >= 2'} order by s.cantidad desc limit 1`);
console.log(`articulo: ${art.nombre} (SGC ${art.c}); conteo +1`);
if (!apply) { console.log('dry-run (usa --apply)'); process.exit(0); }
const claims = JSON.stringify({ sub: admin.id, role: 'authenticated' });
const as = (q) => sql(`select set_config('request.jwt.claims', ${lit(claims)}, true); ${q}`);
const { kw } = await conectar();
const quant = async () => (await kw('stock.quant', 'search_read', [[['location_id', '=', WH.loc], ['product_id', '=', art.p]]], { fields: ['quantity'] })).reduce((s, x) => s + x.quantity, 0);
const antes = argv.includes('--antes') ? Number(argv[argv.indexOf('--antes') + 1]) : await quant(); console.log('quant Odoo antes:', antes);
const reanudar = argv.includes('--conteo') ? argv[argv.indexOf('--conteo') + 1] : null;
if (!reanudar) await sql(`update sgc.conteos_inventario set estado='cancelado' where bodega_id=${lit(WH.id)} and estado in ('borrador','contado') and creado_por=${lit(admin.id)}`);
const id = reanudar ?? (await as(`select sgc.conteo_fisico_abrir(${lit(WH.id)}) as abrir`))[0].abrir; console.log('conteo', id);
if (!reanudar) {
  await as(`select sgc.conteo_fisico_guardar(${lit(id)}, ${lit(JSON.stringify([{ articulo_id: art.id, cantidad_contada: argv.includes('--objetivo') ? Number(argv[argv.indexOf('--objetivo') + 1]) : art.c + 1 }]))}::jsonb)`);
  await as(`select sgc.conteo_fisico_cerrar(${lit(id)})`);
  await as(`select sgc.conteo_fisico_aplicar(${lit(id)}, 'Validacion Odoo (Tecnologia): se deshace')`);
}
const esperar = async (cond, et) => { for (let i = 0; i < 24; i++) { await dormir(10000); const ev = await sql(`select estado, error from sgc.odoo_eventos where agregado_tipo='conteo_inventario' and agregado_id=${lit(id)} order by creado_en desc limit 1`); const q = await quant(); if (cond(ev[0], q)) { console.log(et, JSON.stringify({ ev: ev[0], q })); return true; } } console.log('TIMEOUT', et); return false; };
const ok1 = await esperar((e, q) => e?.estado === 'completado' && Math.abs(q - (argv.includes('--objetivo') ? Number(argv[argv.indexOf('--objetivo') + 1]) : antes + 1)) < 1e-6, 'aplicado en Odoo');
if (argv.includes('--reponer')) { console.log(ok1 ? 'REPOSICION OK' : 'REPOSICION CON HALLAZGOS'); process.exit(0); }
console.log('--- deshaciendo');
await as(`select sgc.conteo_fisico_deshacer(${lit(id)})`);
await dormir(5000);
const ok2 = await esperar((e, q) => e?.estado === 'completado' && Math.abs(q - antes) < 1e-6, 'compensado en Odoo');
console.log('SGC despues:', JSON.stringify(await sql(`select cantidad::float c from sgc.stock_por_bodega where articulo_id=${lit(art.id)} and bodega_id=${lit(WH.id)}`)), 'esperado', antes);
console.log(ok1 && ok2 ? 'CONTEO OK' : 'CONTEO CON HALLAZGOS');
