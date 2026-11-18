// 2026-11-17 -- Cierra la homologacion de proveedores en PROD: (a) ambiguos (varios partners con el mismo nombre): se elige el que coincide por RNC/vat, si no el
// mas antiguo; (b) sin contraparte: se crea el partner proveedor en Odoo y se vincula. (c) marca como omitidos los eventos de maestros de prueba y reencola
// el de "Prueba XT" que fallo antes de vincular. Autorizado por Xaviel (17-nov: "todo lo demas hazlo tambien").
//   node scripts/data-fixes/2026-11-17-ds-proveedores-resto-prod.mjs --env prod --yes [--apply]
import { resolverEnv } from '../lib/entorno.mjs';
import { consulta } from '../lib/dbq-dev.mjs';
import { conectar } from '../lib/odoo-staging.mjs';
const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'prod') { console.error('Solo prod.'); process.exit(1); }
process.env.SGC_INTEGRATION_ODOO_URL = process.env.ODOO_URL_PROD; process.env.SGC_INTEGRATION_ODOO_DB = process.env.ODOO_DB_PROD;
const apply = argv.includes('--apply');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(srl|sa|eirl|sas|ltda|s r l|s a)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const { kw } = await conectar();
const [inst] = await consulta(env, "select id from sgc.odoo_instancias where habilitada and entorno='prod'");
const partners = await kw('res.partner', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'vat'], limit: 20000 });
const porNombre = new Map(); for (const p of partners) { const n = norm(p.name); if (n) (porNombre.get(n) ?? porNombre.set(n, []).get(n)).push(p); }
const usados = new Set((await consulta(env, 'select odoo_id from sgc.proveedores where odoo_id is not null')).map((r) => Number(r.odoo_id)));
const sgc = await consulta(env, "select id, nombre, rnc from sgc.proveedores where odoo_id is null and activo and not coalesce(es_prueba,false)");
let amb = 0, crear = 0;
for (const s of sgc) {
  const c = porNombre.get(norm(s.nombre)) ?? [];
  let pid = null;
  if (c.length > 1) {
    const v = dig(s.rnc); const m = v.length >= 9 ? c.find((x) => dig(x.vat) === v) : null;
    pid = (m ?? c.filter((x) => !usados.has(x.id)).sort((a, b) => a.id - b.id)[0])?.id ?? null; if (pid) amb++;
  } else if (c.length === 0) {
    crear++; if (apply) { const r = await kw('res.partner', 'create', [{ name: s.nombre, supplier_rank: 1, ...(dig(s.rnc).length >= 9 ? { vat: s.rnc } : {}) }]); pid = Array.isArray(r) ? r[0] : r; }
  }
  if (pid && apply) { usados.add(pid); await consulta(env, `update sgc.proveedores set odoo_instancia_id=${lit(inst.id)}, odoo_id=${pid}, odoo_ultima_sync=now() where id=${lit(s.id)} and odoo_id is null`); }
}
console.log(`${apply ? 'hecho' : 'dry-run'}: ambiguos resueltos ${amb}, partners a crear ${crear}, restantes sin vincular ${sgc.length - amb - crear}`);
if (!apply) process.exit(0);
await consulta(env, `update sgc.odoo_eventos set estado='completado', error=null where estado='pendiente' and es_prueba`);
await consulta(env, `update sgc.odoo_eventos set estado='pendiente', error=null, proximo_intento_en=null where estado='error' and agregado_tipo='proveedor'`);
console.log(JSON.stringify(await consulta(env, 'select count(*) filter (where odoo_id is not null) vinc, count(*) total from sgc.proveedores')));
