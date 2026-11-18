// 2026-11-17 -- Vincula en PROD los proveedores de SGC con los res.partner del Odoo real (RNC/vat identico y unico, o nombre normalizado
// identico y unico). Crea y vincula el proveedor de prueba "Prueba XT" (partner en Odoo) para validar la OC real. Autorizado por Xaviel (17-nov).
//   node scripts/data-fixes/2026-11-17-ds-proveedores-prod.mjs --env prod --yes [--apply]
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
const porNombre = new Map(), porVat = new Map();
for (const p of partners) { const n = norm(p.name); if (n) (porNombre.get(n) ?? porNombre.set(n, []).get(n)).push(p.id); const v = dig(p.vat); if (v.length >= 9) (porVat.get(v) ?? porVat.set(v, []).get(v)).push(p.id); }
const sgc = await consulta(env, "select id, nombre, rnc from sgc.proveedores where odoo_id is null and activo and not coalesce(es_prueba,false) and nombre <> 'Prueba XT'");
const usados = new Set(); let porRnc = 0, porNom = 0, sinMatch = 0, amb = 0; const sentencias = [];
const nombresSgc = new Map(); for (const s of sgc) nombresSgc.set(norm(s.nombre), (nombresSgc.get(norm(s.nombre)) ?? 0) + 1);
for (const s of sgc) {
  let id = null, via = null; const v = dig(s.rnc);
  if (v.length >= 9 && porVat.get(v)?.length === 1) { id = porVat.get(v)[0]; via = 'rnc'; }
  else if (porNombre.get(norm(s.nombre))?.length === 1 && nombresSgc.get(norm(s.nombre)) === 1) { id = porNombre.get(norm(s.nombre))[0]; via = 'nombre'; }
  else if ((porNombre.get(norm(s.nombre))?.length ?? 0) > 1) amb++; else sinMatch++;
  if (!id || usados.has(id)) { if (id) amb++; continue; }
  usados.add(id); via === 'rnc' ? porRnc++ : porNom++;
  sentencias.push(`update sgc.proveedores set odoo_instancia_id=${lit(inst.id)}, odoo_id=${id}, odoo_ultima_sync=now() where id=${lit(s.id)} and odoo_id is null`);
}
console.log(`SGC sin vincular: ${sgc.length} | por RNC: ${porRnc} | por nombre: ${porNom} | ambiguos: ${amb} | sin contraparte: ${sinMatch}`);
if (!apply) { console.log('dry-run (usa --apply)'); process.exit(0); }
for (let i = 0; i < sentencias.length; i += 50) await consulta(env, sentencias.slice(i, i + 50).join(';\n'));
// Proveedor de prueba para validar la OC real
const [px] = await consulta(env, "select id, odoo_id from sgc.proveedores where nombre='Prueba XT' order by created_at limit 1");
if (px && !px.odoo_id) {
  const ex = await kw('res.partner', 'search_read', [[['name', '=', 'Prueba XT']]], { fields: ['id'], context: { active_test: false }, limit: 1 });
  let pid = ex[0]?.id; if (!pid) { pid = await kw('res.partner', 'create', [{ name: 'Prueba XT', supplier_rank: 1, comment: 'Proveedor de prueba creado desde SGC (validacion de OC real). Se puede archivar.' }]); pid = Array.isArray(pid) ? pid[0] : pid; }
  await consulta(env, `update sgc.proveedores set odoo_instancia_id=${lit(inst.id)}, odoo_id=${pid}, odoo_ultima_sync=now() where id=${lit(px.id)}`);
  console.log('Prueba XT -> partner', pid);
}
console.log(JSON.stringify(await consulta(env, 'select count(*) filter (where odoo_id is not null) vinc, count(*) total from sgc.proveedores')));
