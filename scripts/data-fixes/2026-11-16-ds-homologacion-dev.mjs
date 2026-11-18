// 2026-11-16 DS-05/DS-06 -- homologacion de almacenes y cuentas analiticas contra Odoo STAGING, en DEV.
// Dry-run por defecto; --apply escribe SOLO en dev (la regla 18 impide prod aqui: --env prod se rechaza).
// Todo se resuelve contra staging por codigo/nombre; nunca se copian ids entre instancias; sin emparejar por nombre libre.
//   node scripts/data-fixes/2026-11-16-ds-homologacion-dev.mjs --env dev [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Este data-fix solo corre en dev (staging de Odoo). Prod: tras OK explicito y ledger.'); process.exit(1); }
const apply = argv.includes('--apply');
const { kw } = await conectar();
const sql = (s) => consulta(env, s);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const log = (...a) => console.log(...a);
const sinEspacios = (c) => c.replace(/\s+/g, '').slice(0, 5);

// 0) La identidad de una instancia es inmutable: staging es una instancia NUEVA. Se registra, se le copian las
// companias y se re-apuntan los vinculos de dev (los ids de staging, copia de prod, coinciden: verificado abajo por nombre).
// La instancia anterior queda deshabilitada (las RPC exigen exactamente una habilitada).
const URL_ST = process.env.SGC_INTEGRATION_ODOO_URL.replace(/\/+$/, '');
const DB_ST = process.env.SGC_INTEGRATION_ODOO_DB;
const [vieja] = await sql(`select id from sgc.odoo_instancias where habilitada and not (base_url=${lit(URL_ST)} and base_datos=${lit(DB_ST)}) limit 1`);
let [nueva] = await sql(`select id from sgc.odoo_instancias where base_url=${lit(URL_ST)} and base_datos=${lit(DB_ST)}`);
log(`\n[0] instancia staging: ${nueva ? 'ya registrada' : 'se registra'}${vieja ? '; la anterior se deshabilita y sus vinculos se re-apuntan' : ''} (${apply ? 'APLICA' : 'dry-run'})`);
const TABLAS = ['activos_fijos', 'articulos', 'bodegas', 'categorias_inventario', 'odoo_comandos_oc', 'odoo_vinculos_stock', 'orden_compra_items',
  'ordenes_compra', 'proveedores', 'proyectos', 'salidas_inventario', 'tec_equipos', 'unidades', 'vehiculos'];
if (apply && !nueva) {
  [nueva] = await sql(`insert into sgc.odoo_instancias(nombre, base_url, base_datos, entorno, habilitada, permitir_salida, permitir_entrada)
    values ('Odoo staging (dev)', ${lit(URL_ST)}, ${lit(DB_ST)}, 'dev', false, false, false) returning id`);
  await sql(`insert into sgc.odoo_companias(instancia_id, odoo_id, nombre, activa) values (${lit(nueva.id)}, 1, 'CONSTRUCTORA SCHEKER & DOMINGUEZ SRL', true) on conflict do nothing`);
  if (vieja) {
    // un solo lote (transaccion): re-apunta vinculos, deshabilita la anterior y habilita staging
    const movs = TABLAS.map((t) => `update sgc.${t} set odoo_instancia_id=${lit(nueva.id)} where odoo_instancia_id=${lit(vieja.id)};`).join('\n');
    await sql(`${movs}\nupdate sgc.odoo_instancias set habilitada=false where id=${lit(vieja.id)};\nupdate sgc.odoo_instancias set habilitada=true where id=${lit(nueva.id)};`);
  } else {
    await sql(`update sgc.odoo_instancias set habilitada=true where id=${lit(nueva.id)}`);
  }
}
const I = (nueva ?? vieja)?.id;
if (!I) throw new Error('No hay instancia Odoo en dev');


// 1) ALMACENES: nombre SGC (patron) -> codigo de almacen de Odoo (mapa de Miranda, resuelto contra stock.warehouse de staging)
const MAPA = [
  ['Bodega Central', 'WH'], ['ASA - Residencial Romo', 'RSR'], ['BATCON - Interplaza', 'INT'], ['BEST IN PRO - City Place', 'CITY'],
  ['BLUEWAVE - Olea', 'Olea'], ['BLUEWAVE - Volares', 'VOLAR'], ['NOVAL - Poseidonia', 'POSE'], ['NOVAL - Riviera', 'RIVI'],
  ['Edif Adm 911', 'ADM11'], ['VISTA CANA - Monterezzo', 'MONT'], ['BRISAS CITY CENTER', 'BCC'], ['las AMERICAS', 'ALMA'],
  ['Villa Caleton', 'VC'], ['SOLHE SIGNATURE', 'SOLSC'], ['Torre Alpha', 'TA'], ['Torre Bol', 'TRB'],
];
const wh = await kw('stock.warehouse', 'search_read', [[['active', 'in', [true, false]]]], { fields: ['id', 'name', 'code', 'lot_stock_id'] });
const whPorCodigo = new Map(wh.map((w) => [w.code, w]));
log('\n[1] almacenes');
const resumenBodegas = { vinculadas: 0, sin_bodega_sgc: [], conflictos: [], ya: 0 };
for (const [patron, codigo] of MAPA) {
  const w = whPorCodigo.get(codigo);
  if (!w) { log(`  ! ${codigo}: no existe en staging`); resumenBodegas.conflictos.push(codigo); continue; }
  const rows = await sql(`select id, nombre, odoo_warehouse_id, odoo_location_id, codigo_odoo from sgc.bodegas where activo and not es_prueba and nombre ilike ${lit('%' + patron + '%')}`);
  if (rows.length !== 1) { log(`  - ${codigo} (${w.name}): ${rows.length === 0 ? 'sin bodega SGC' : rows.length + ' bodegas candidatas, ambiguo'}`); resumenBodegas.sin_bodega_sgc.push(codigo); continue; }
  const b = rows[0];
  if (b.odoo_warehouse_id && b.odoo_warehouse_id !== w.id) { log(`  ! CONFLICTO ${b.nombre}: SGC=${b.odoo_warehouse_id} staging(${codigo})=${w.id}`); resumenBodegas.conflictos.push(codigo); continue; }
  if (b.codigo_odoo === sinEspacios(codigo)) { resumenBodegas.ya++; continue; }
  log(`  + ${b.nombre} <- ${codigo} (wh ${w.id}, loc ${w.lot_stock_id[0]})`);
  if (apply) {
    await sql(`update sgc.bodegas set odoo_instancia_id=${lit(I)}, odoo_compania_id=1, odoo_warehouse_id=${w.id}, odoo_location_id=${w.lot_stock_id[0]}, codigo_odoo=${lit(sinEspacios(codigo))}, codigo_odoo_raw=${lit(codigo)}, odoo_ultima_sync=now() where id=${lit(b.id)}`);
  }
  resumenBodegas.vinculadas++;
}
const noGest = wh.filter((w) => !MAPA.some(([, c]) => c === w.code)).map((w) => w.code);
log(`  almacenes de Odoo no gestionados: ${noGest.join(', ')}`);

// 2) CUENTAS ANALITICAS -- los 10 seguros de Miranda: solo si id Y nombre coinciden en staging
const SEGUROS = [
  ['CSD-101', 23, /romo/i], ['CSD-104', 2, /olea/i], ['CSD-105', 9, /volares/i], ['CSD-106', 33, /poseidonia/i], ['CSD-107', 16, /riviera/i],
  ['CSD-108', 15, /911/i], ['CSD-109', 24, /monterrezzo/i], ['CSD-001', 11, /brisas/i], ['PROY-0003', 41, /caleton/i], ['PROY-0004', 42, /solhe/i],
];
const ana = await kw('account.analytic.account', 'search_read', [[]], { fields: ['id', 'name', 'active'], context: { active_test: false } });
const anaPorId = new Map(ana.map((a) => [a.id, a]));
log('\n[2] cuentas analiticas seguras');
for (const [cod, id, rx] of SEGUROS) {
  const a = anaPorId.get(id);
  const [p] = await sql(`select id, nombre, odoo_analytic_id from sgc.proyectos where codigo=${lit(cod)}`);
  if (!p) { log(`  - ${cod}: no existe en dev`); continue; }
  if (!a || !rx.test(a.name)) { log(`  ! ${cod}: id ${id} no coincide en staging (${a?.name ?? 'inexistente'}) -> NO se enlaza`); continue; }
  if (p.odoo_analytic_id && p.odoo_analytic_id !== id) { log(`  ! ${cod}: ya enlazado a ${p.odoo_analytic_id} != ${id}`); continue; }
  log(`  + ${cod} -> ${id} ${a.name} (confirmado)`);
  if (apply) {
    await sql(`update sgc.proyectos set odoo_instancia_id=${lit(I)}, odoo_compania_id=1, odoo_analytic_id=${id}, odoo_analytic_confirmado=true where id=${lit(p.id)};
      insert into sgc.proyecto_odoo_analiticas(proyecto_id, odoo_instancia_id, odoo_analytic_id, rol, confirmado, confirmado_en, evidencia)
      values (${lit(p.id)}, ${lit(I)}, ${id}, 'principal', true, now(), ${lit(JSON.stringify({ fuente: 'miranda-2026-11-08', nombre_staging: a.name }))}::jsonb)
      on conflict (odoo_instancia_id, odoo_analytic_id) do nothing`);
  }
}

// 3) LAS 4 DUDOSAS -- regla de evidencia: uso real de cada cuenta en lineas de compra de staging
log('\n[3] cuentas dudosas (evidencia de uso en lineas de compra)');
const lineas = await kw('purchase.order.line', 'search_read', [[['analytic_distribution', '!=', false]]], { fields: ['analytic_distribution'], limit: 20000 });
const uso = new Map();
for (const l of lineas) for (const k of Object.keys(l.analytic_distribution || {})) for (const idStr of k.split(',')) uso.set(Number(idStr), (uso.get(Number(idStr)) || 0) + 1);
const DUDOSAS = [['CSD-102', [21, 28]], ['CSD-103', [26, 17]], ['PROY-0002', [29, 37]], ['PROY-0005', [44]]];
const informe = [];
for (const [cod, cands] of DUDOSAS) {
  const [p] = await sql(`select id, nombre, estado, odoo_analytic_id from sgc.proyectos where codigo=${lit(cod)}`);
  const evid = cands.map((id) => ({ id, existe: anaPorId.has(id), nombre: anaPorId.get(id)?.name ?? null, lineas_compra: uso.get(id) || 0 }));
  const validas = evid.filter((e) => e.existe).sort((a, b) => b.lineas_compra - a.lineas_compra);
  const conUso = validas.filter((e) => e.lineas_compra > 0);
  log(`  ${cod}${p ? '' : ' (NO existe en dev)'}: ${JSON.stringify(evid)}`);
  if (!p || conUso.length === 0) { informe.push({ cod, resultado: 'sin_enlace', evid }); continue; }
  informe.push({ cod, resultado: conUso.length > 1 ? 'principal+adicional' : 'principal', evid });
  if (!apply) continue;
  const [prin, ...resto] = conUso;
  const ev = (e) => lit(JSON.stringify({ fuente: 'ds-evidencia-staging', ...e, estado_proyecto: p.estado }));
  await sql(`update sgc.proyectos set odoo_instancia_id=${lit(I)}, odoo_compania_id=1, odoo_analytic_id=${prin.id}, odoo_analytic_confirmado=false where id=${lit(p.id)};
    insert into sgc.proyecto_odoo_analiticas(proyecto_id, odoo_instancia_id, odoo_analytic_id, rol, confirmado, evidencia)
    values (${lit(p.id)}, ${lit(I)}, ${prin.id}, 'principal', false, ${ev(prin)}::jsonb) on conflict (odoo_instancia_id, odoo_analytic_id) do nothing`);
  for (const e of resto) {
    await sql(`insert into sgc.proyecto_odoo_analiticas(proyecto_id, odoo_instancia_id, odoo_analytic_id, rol, confirmado, evidencia)
      values (${lit(p.id)}, ${lit(I)}, ${e.id}, 'adicional', false, ${ev(e)}::jsonb) on conflict (odoo_instancia_id, odoo_analytic_id) do nothing`);
  }
}
log('\nResumen almacenes:', JSON.stringify(resumenBodegas));
log('Resumen dudosas:', JSON.stringify(informe.map((i) => [i.cod, i.resultado])));
log(apply ? '\nAPLICADO en dev.' : '\n(dry-run: nada escrito; usa --apply)');
