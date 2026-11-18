// 2026-11-17 -- CORTE de Bodega Central (WH) en PROD: Odoo pasa a ser la fuente del stock de esa bodega. Autorizado por Xaviel (17-nov):
// fecha de corte unica (hoy), cambiable despues desde SGC (Inventario > Ajustes Odoo > Corte, rol admin); solo Central primero.
// Pasos (cada uno se corre aparte): preparar (fase corte + fecha) | plan (solo calcula) | aplicar (apertura en Odoo) | opcion-a (respaldo + sin apertura + fuente Odoo) | fuente (Odoo = fuente) | apagar (revierte fuente y fase).
//   node scripts/data-fixes/2026-11-17-ds-corte-central-prod.mjs --env prod --yes --paso preparar|plan|aplicar|fuente|apagar [--tope 0.5]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
const paso = argv[argv.indexOf('--paso') + 1];
const tope = argv.includes('--tope') ? Number(argv[argv.indexOf('--tope') + 1]) : 0.5;
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const [admin] = await sql(`select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.activo and u.nombre='Xaviel Terrero' limit 1`);
const [WH] = await sql(`select id from sgc.bodegas where codigo_odoo='WH'`);
const [ins] = await sql(`select id from sgc.odoo_instancias where habilitada and entorno='prod'`);
const as = (q) => sql(`select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin.id, role: 'authenticated' }))}, true); ${q}`);
const hoy = (await sql(`select (now() at time zone 'America/Santo_Domingo')::date::text d`))[0].d;
const estado = async () => console.log(JSON.stringify({ fases: await sql(`select clave, habilitada from sgc.odoo_fases order by clave`), corte: await sql(`select fecha_corte, apertura_hecha, apertura_error, fuente_odoo, apertura_resultado from sgc.odoo_corte_bodega where bodega_id=${lit(WH.id)}`) }));
async function edge(modo) {
  const r = await fetch(`${env.url}/functions/v1/odoo-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-secret': process.env.ODOO_SYNC_SECRET_PROD ?? '' }, body: JSON.stringify({ accion: 'apertura', instancia_id: ins.id, bodega_id: WH.id, modo, tope }) });
  const j = await r.json().catch(() => ({})); console.log('HTTP', r.status);
  if (j.lineas) j.lineas = `${j.lineas.length} lineas`; if (Array.isArray(j.ajustes)) { const n = j.ajustes.length; j.muestra = j.ajustes.slice(0, 8); j.ajustes = `${n} ajustes`; }
  console.log(JSON.stringify(j));
}
if (paso === 'preparar') { await as(`select sgc.odoo_fase_set('corte', true); select sgc.odoo_corte_configurar(${lit(WH.id)}, ${lit(hoy)}::date, false);`); await estado(); }
else if (paso === 'plan') await edge('plan');
else if (paso === 'aplicar') { await edge('aplicar'); await estado(); }
else if (paso === 'fuente') { await as(`select sgc.odoo_corte_fuente_set(${lit(WH.id)}, true)`); await estado(); }
else if (paso === 'opcion-a') {
  // Opcion A (decision de Xaviel, 17-nov): Odoo es la verdad; NO se escribe la apertura en Odoo. Se respalda el stock SGC de la bodega,
  // se marca la apertura como hecha (sin ajustes) y Odoo pasa a ser la fuente: la proyeccion (sondeo cada 5 min) alinea SGC a Odoo.
  await sql(`insert into sgc.odoo_corte_respaldo_stock (bodega_id, articulo_id, cantidad, motivo) select bodega_id, articulo_id, cantidad, 'Corte Central opcion A 2026-11-17' from sgc.stock_por_bodega where bodega_id=${lit(WH.id)} and not exists (select 1 from sgc.odoo_corte_respaldo_stock r where r.bodega_id=${lit(WH.id)} and r.motivo='Corte Central opcion A 2026-11-17')`);
  console.log('respaldo filas:', JSON.stringify(await sql(`select count(*) n from sgc.odoo_corte_respaldo_stock where bodega_id=${lit(WH.id)}`)));
  await as(`select sgc.odoo_corte_configurar(${lit(WH.id)}, ${lit(hoy)}::date, true)`);
  await sql(`update sgc.odoo_corte_bodega set apertura_en=now(), apertura_resultado='{"modo":"odoo_manda","ajustes":0,"nota":"Opcion A: SGC se alinea a Odoo; no se escribio apertura en Odoo"}'::jsonb where bodega_id=${lit(WH.id)}`);
  await as(`select sgc.odoo_corte_fuente_set(${lit(WH.id)}, true)`); await estado();
}
else if (paso === 'apagar') { await as(`select sgc.odoo_corte_fuente_set(${lit(WH.id)}, false); select sgc.odoo_fase_set('corte', false)`); await estado(); }
else { console.error('--paso preparar|plan|aplicar|fuente|apagar'); process.exit(1); }
