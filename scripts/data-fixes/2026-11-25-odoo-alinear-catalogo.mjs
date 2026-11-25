// 2026-11-25 -- Hotfix Odoo 19: alinea el catálogo de SGC con Odoo (fuente de verdad). Pedido y autorizado por Xaviel.
//   - Los artículos vinculados toman el nombre EXACTO de Odoo (el nombre viejo queda como apodo si cambia de verdad).
//   - Artículos de SGC sin vínculo que coinciden por nombre con un producto de Odoo se vinculan.
//   - Lo que sigue en «(Revisión)» se mueve a la categoría que le toca por su categoría de Odoo.
//   - Productos ALMACENABLES y ACTIVOS de Odoo que no existen en SGC se crean. Servicios/no almacenables y archivados, no.
// Solo lectura sobre Odoo. Por defecto SIMULA (no escribe); con --aplicar escribe, vía sgc.odoo_catalogo_alinear.
//   node scripts/data-fixes/2026-11-25-odoo-alinear-catalogo.mjs --env prod            (simulación)
//   node scripts/data-fixes/2026-11-25-odoo-alinear-catalogo.mjs --env prod --yes --aplicar
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const env = await resolverEnv(args);
const E = env.entorno.toUpperCase();
const url = process.env[`SUPABASE_URL_${E}`];
const key = process.env[`SUPABASE_SERVICE_ROLE_KEY_${E}`];
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc' };
const rest = async (m, p, b) => { const r = await fetch(`${url}/rest/v1/${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${p}: ${r.status} ${t}`); return t ? JSON.parse(t) : null; };

// ---- Odoo (solo lectura, JSON-RPC)
const ODOO = (process.env.SGC_INTEGRATION_ODOO_URL ?? '').replace(/\/+$/, '');
const DB = process.env.ODOO_DB_PROD || process.env.SGC_INTEGRATION_ODOO_DB;
const USER = process.env.SGC_INTEGRATION_ODOO_USER;
const KEY = process.env.SGC_INTEGRATION_ODOO_API_KEY;
if (!ODOO || !DB || !USER || !KEY) throw new Error('Faltan credenciales de Odoo en .env.local (SGC_INTEGRATION_ODOO_*, ODOO_DB_PROD)');
let rid = 0;
const call = async (service, method, a) => {
  const r = await fetch(`${ODOO}/jsonrpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args: a }, id: ++rid }) });
  const j = await r.json(); if (j.error) throw new Error(String(j.error.data?.message ?? JSON.stringify(j.error))); return j.result;
};
const uid = await call('common', 'authenticate', [DB, USER, KEY, {}]);
const x = (model, method, a, kw = {}) => call('object', 'execute_kw', [DB, uid, KEY, model, method, a, kw]);
const prods = await x('product.product', 'search_read', [[['active', 'in', [true, false]]]], { fields: ['id', 'name', 'default_code', 'categ_id', 'uom_id', 'active', 'is_storable', 'product_tmpl_id'], limit: 20000 });

// ---- Categorías: categoría de Odoo -> categoría de inventario de SGC (precedente: lo que ya estaba clasificado)
const cats = await rest('GET', 'categorias_inventario?select=id,nombre');
const idCat = (n) => { const c = cats.find((k) => k.nombre === n); if (!c) throw new Error(`Falta la categoría SGC «${n}»`); return c.id; };
const MAPA = {
  'EPP': 'EPP (Equipos de Protección Personal)', 'UNIFORMES': 'EPP (Equipos de Protección Personal)',
  'SUMINISTROS DE OFICINA': 'Material de Oficina', 'ACTIVO OFICINA': 'Material de Oficina', 'ACTIVO DE OFICINA EN OBRA': 'Material de Oficina',
  'HERRAMIENTAS': 'Equipos y Herramientas', 'MADERA': 'Materia Prima (Madera, Palos, Plywood)',
  'MATERIALES CONSUMIBLES': 'Materiales Consumibles', 'MATERIAL ELECTRICO': 'Materiales Consumibles', 'PRODUCTOS QUIMICOS': 'Materiales Consumibles',
  'MOLDES Y ACCESORIOS SD': 'Moldes y Accesorios', 'MOLDES Y ACCESORIOS RENTADOS': 'Moldes y Accesorios', 'EQUIPOS PARA ENCOFRADO EV': 'Moldes y Accesorios',
  'EQUIPOS PARA APUNTALAMIENTOS': 'Equipos de Apuntalamiento',
};
const categoriaDe = (p) => idCat(MAPA[String(p.categ_id?.[1] ?? '').trim()] ?? 'Otros');

const [inst] = await rest('GET', 'odoo_instancias?habilitada=eq.true&select=id');
if (!inst) throw new Error('No hay instancia Odoo habilitada');

// Respaldo de nombres/categorías antes de tocar (para revertir a mano).
const antes = await rest('GET', 'articulos?select=id,codigo,nombre,categoria_id,odoo_product_id&order=id&limit=5000');
const dir = join(tmpdir(), 'sgc-odoo-alinear'); mkdirSync(dir, { recursive: true });
const respaldo = join(dir, `respaldo-articulos-${env.entorno}-${Date.now()}.json`);
writeFileSync(respaldo, JSON.stringify(antes));
console.log(`Respaldo previo: ${respaldo} (${antes.length} artículos)`);

const filas = prods.map((p) => ({
  product_id: p.id, template_id: p.product_tmpl_id?.[0], nombre: p.name, codigo: p.default_code || null,
  unidad: p.uom_id?.[1] ?? 'Unidad', categoria_id: categoriaDe(p), crear: !!(p.is_storable && p.active),
}));

const tot = { renombrados: 0, apodos_nuevos: 0, vinculados: 0, reclasificados: 0, creados: 0, sin_cambio_de_nombre: 0, omitidos: 0 };
const colisiones = []; const ejemplos = [];
for (let i = 0; i < filas.length; i += 250) {
  const r = await rest('POST', 'rpc/odoo_catalogo_alinear', { p_instancia: inst.id, p_filas: filas.slice(i, i + 250), p_aplicar: aplicar });
  for (const k of Object.keys(tot)) tot[k] += r[k] ?? 0;
  colisiones.push(...(r.colisiones ?? [])); if (ejemplos.length < 12) ejemplos.push(...(r.ejemplos ?? []));
}
console.log(aplicar ? 'APLICADO' : 'SIMULACIÓN (no se escribió nada)', JSON.stringify(tot));
console.log('Ejemplos de renombre:', JSON.stringify(ejemplos.slice(0, 12), null, 1));
console.log(`Colisiones de nombre (Odoo tiene dos productos con el mismo nombre): ${colisiones.length}`, JSON.stringify(colisiones.slice(0, 20), null, 1));
