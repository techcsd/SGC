// 2026-11-27 -- PROMPT-158 F2.5 (EB-04): reencolar las salidas de inventario que fallaron SOLO por el campo de Odoo 17
// (`move_ids_without_package`) y no por stock. Hoy son 2 eventos (25-nov y 27-nov). NO toca los `sin_stock` del 18-nov (EB12).
//
//   node scripts/data-fixes/2026-11-27-eb-reintentar-salidas.mjs --env prod --yes               (SIMULACION: solo SELECT, no escribe)
//   node scripts/data-fixes/2026-11-27-eb-reintentar-salidas.mjs --env prod --ejecutar --solo <evento_id> --ok "<texto de Xaviel>"
//   node scripts/data-fixes/2026-11-27-eb-reintentar-salidas.mjs --env prod --ejecutar --ok "<texto de Xaviel>"   (el resto)
//
// REGLAS: (1) correr SOLO despues de que el fix de Odoo 19 (1.225.2 y las edges odoo-sync/odoo-api) este en ese entorno;
// (2) --ejecutar exige --ok con el OK nombrado de Xaviel; (3) primero UN evento (--solo), verificar en Odoo (solo lectura)
// que nacio UN picking con el `origin` correcto, y recien despues el resto; (4) es idempotente: la edge busca el picking por
// `origin` (buscarPickingPorOrigin) antes de crear, asi que reencolar no duplica. Equivale a «Reintentar» en Sincronizacion con Odoo.
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const ejecutar = argv.includes('--ejecutar');
const solo = flag('--solo');
const ok = flag('--ok');
const env = await resolverEnv(argv);

const sql = (q) => dbQuery(env, q);

// Candidatos: salida_inventario/crear en error por el campo viejo, posteriores al 25-nov, sin sin_stock.
const filtro = `e.agregado_tipo = 'salida_inventario' and e.accion = 'crear' and e.estado = 'error'
  and e.creado_en >= '2026-11-25' and e.error ilike '%move_ids_without_package%' and e.error not ilike '%sin_stock%'
  and e.es_prueba = false${solo ? ` and e.id = '${solo.replace(/[^0-9a-f-]/gi, '')}'` : ''}`;
const filas = await sql(`select e.id::text, e.agregado_id, e.creado_en::text, e.intentos, left(e.error, 90) error
  from sgc.odoo_eventos e where ${filtro} order by e.creado_en`);

console.log(`Entorno: ${env.entorno} · candidatos: ${filas.length}`);
for (const f of filas) console.log(` - evento ${f.id} · salida ${f.agregado_id} · ${f.creado_en} · intentos ${f.intentos} · ${f.error}`);

if (!ejecutar) { console.log('\nSIMULACION: no se escribio nada. Para ejecutar: --ejecutar --ok "<OK nombrado>" (y --solo <id> para el de prueba).'); process.exit(0); }
if (!ok || ok.trim().length < 5) { console.error('--ejecutar exige --ok "<texto del OK nombrado de Xaviel>"'); process.exit(2); }
if (!solo && filas.length > 1) console.log('Aviso: se reencolaran todos; recomendado haber probado antes con --solo.');

for (const f of filas) {
  await sql(`with u as (update sgc.odoo_eventos set estado = 'pendiente', lease_token = null, lease_hasta = null, actualizado_en = now()
      where id = '${f.id}' and estado = 'error' returning id)
    insert into sgc.odoo_intentos (evento_id, procesador, lease_token, estado_resultado, resultado, error, reclamado_en)
    select id, 'eb-data-fix-2026-11-27', gen_random_uuid(), 'reintento', null, 'Reencolado por EB F2.5 tras el fix de Odoo 19', now() from u`);
  console.log(`reencolado ${f.id}`);
}
console.log('Listo. Verifica en Sincronizacion con Odoo y, solo lectura, que el picking nacio una sola vez con su origin.');
