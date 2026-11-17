// DS-07 -- propone la homologacion de articulos SGC <-> productos de Odoo (staging) por niveles y la deja para aprobacion.
//   1 codigo   : default_code de Odoo == codigo del articulo  -> propuesta con score 1 (auto-aprobable con --auto-codigo)
//   2 nombre   : nombre normalizado (sin tildes/mayusculas/espacios/signos) identico
//   3 similitud: similitud de trigramas >= 0.6
//   4 sin contraparte: no se propone nada (va a «Productos por dar de alta»)
// Dry-run por defecto (imprime el informe). --apply guarda las propuestas en dev. Nunca vincula salvo --auto-codigo (nivel 1).
//   node scripts/odoo-homologar-catalogo.mjs --env dev [--apply] [--auto-codigo]
import { resolverEnv } from './lib/entorno.mjs';
import { consulta } from './lib/dbq-dev.mjs';
import { conectar } from './lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev (staging de Odoo).'); process.exit(1); }
const apply = argv.includes('--apply');
const autoCodigo = argv.includes('--auto-codigo');
const lit = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const trigramas = (s) => { const t = `  ${norm(s)} `; const set = new Set(); for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3)); return set; };
const similitud = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; return a.size && b.size ? inter / (a.size + b.size - inter) : 0; }; // Jaccard de trigramas

const { kw } = await conectar();
const [inst] = await consulta(env, 'select id from sgc.odoo_instancias where habilitada limit 1');
if (!inst) throw new Error('No hay instancia habilitada en dev');
const prods = await kw('product.product', 'search_read', [[['purchase_ok', '=', true]]], { fields: ['id', 'name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id'], limit: 5000 });
const articulos = await consulta(env, `select id, codigo, nombre from sgc.articulos where activo and not coalesce(es_prueba,false) and odoo_product_id is null`);
const yaVinculados = new Set((await consulta(env, 'select odoo_product_id from sgc.articulos where odoo_product_id is not null')).map((r) => Number(r.odoo_product_id)));
const libres = prods.filter((p) => !yaVinculados.has(p.id));
const porCodigo = new Map(libres.filter((p) => p.default_code).map((p) => [norm(p.default_code), p]));
const porNombre = new Map(); for (const p of libres) { const k = norm(p.name); if (!porNombre.has(k)) porNombre.set(k, []); porNombre.get(k).push(p); }
const triProd = libres.map((p) => [p, trigramas(p.name)]);

const propuestas = []; const sin = [];
for (const a of articulos) {
  let hit = null; let metodo; let score;
  const pc = a.codigo ? porCodigo.get(norm(a.codigo)) : null;
  if (pc) { hit = pc; metodo = 'codigo'; score = 1; }
  else {
    const pn = porNombre.get(norm(a.nombre));
    if (pn?.length === 1) { hit = pn[0]; metodo = 'nombre'; score = 0.99; }
    else if (!pn) {
      const ta = trigramas(a.nombre); let mejor = null; let ms = 0; let segundo = 0;
      for (const [p, tp] of triProd) { const s = similitud(ta, tp); if (s > ms) { segundo = ms; ms = s; mejor = p; } else if (s > segundo) segundo = s; }
      if (mejor && ms >= 0.6) { hit = mejor; metodo = 'similitud'; score = Math.round(ms * 1000) / 1000; }
    }
  }
  if (hit) propuestas.push({ a, p: hit, metodo, score }); else sin.push(a);
}
// Un producto de Odoo no puede ir a dos articulos: se queda el de mayor score; el resto, sin contraparte.
const usados = new Map(); for (const x of propuestas.sort((m, n) => n.score - m.score)) { if (!usados.has(x.p.id)) usados.set(x.p.id, x); }
const finales = [...usados.values()];
const conteo = (m) => finales.filter((x) => x.metodo === m).length;
console.log(`[${env.entorno}] articulos sin vincular: ${articulos.length} | productos Odoo comprables libres: ${libres.length}`);
console.log(`  codigo exacto: ${conteo('codigo')} | nombre exacto: ${conteo('nombre')} | similitud>=0.6: ${conteo('similitud')} | sin contraparte: ${articulos.length - finales.length}`);
const pct = (n) => (articulos.length ? Math.round((n / articulos.length) * 100) : 0);
console.log(`  % exacto ${pct(conteo('codigo') + conteo('nombre'))} | % propuesta ${pct(conteo('similitud'))} | % sin contraparte ${pct(articulos.length - finales.length)}`);
console.log('  muestra:'); for (const x of finales.slice(0, 8)) console.log(`   ${x.metodo.padEnd(9)} ${x.score} | ${x.a.nombre}  ->  ${x.p.name}`);

// Piloto: los 5 articulos con mas movimiento (salidas+entradas) con coincidencia exacta
const mov = await consulta(env, `select articulo_id, sum(c) mov from (
  select articulo_id, count(*) c from sgc.detalle_salidas group by 1 union all select articulo_id, count(*) from sgc.detalle_entradas group by 1) t group by 1`);
const movMap = new Map(mov.map((r) => [r.articulo_id, Number(r.mov)]));
const exactos = finales.filter((x) => x.metodo !== 'similitud');
const piloto = (exactos.length >= 5 ? exactos : finales).sort((m, n) => (movMap.get(n.a.id) ?? 0) - (movMap.get(m.a.id) ?? 0)).slice(0, 5);
console.log(`  PILOTO (5 de mayor movimiento${exactos.length >= 5 ? ' con coincidencia exacta' : '; no hay 5 exactos, se toman de las propuestas y exigen aprobacion'}):`); for (const x of piloto) console.log(`   mov=${movMap.get(x.a.id) ?? 0} | ${x.a.nombre} -> ${x.p.name}`);
if (!apply) { console.log('\n(dry-run: nada escrito; usa --apply)'); process.exit(0); }

let guardadas = 0;
for (const x of finales) {
  await consulta(env, `insert into sgc.odoo_homologacion_propuestas(odoo_instancia_id, articulo_id, odoo_product_id, odoo_template_id, nombre_odoo, codigo_odoo, categoria_odoo, uom_odoo, metodo, score, estado)
    values (${lit(inst.id)}, ${lit(x.a.id)}, ${x.p.id}, ${x.p.product_tmpl_id[0]}, ${lit(x.p.name)}, ${lit(x.p.default_code || null)}, ${lit(x.p.categ_id?.[1])}, ${lit(x.p.uom_id?.[1])}, ${lit(x.metodo)}, ${x.score}, 'propuesta')
    on conflict (odoo_instancia_id, articulo_id, odoo_product_id) do nothing`);
  guardadas++;
}
if (autoCodigo) {
  await consulta(env, `select id from sgc.odoo_homologacion_propuestas where false`);
  for (const x of finales.filter((m) => m.metodo === 'codigo')) {
    await consulta(env, `update sgc.articulos set odoo_instancia_id=${lit(inst.id)}, odoo_product_id=${x.p.id}, odoo_template_id=${x.p.product_tmpl_id[0]}, odoo_ultima_sync=now() where id=${lit(x.a.id)} and odoo_product_id is null;
      update sgc.odoo_homologacion_propuestas set estado='aprobada', decidido_en=now() where articulo_id=${lit(x.a.id)} and odoo_product_id=${x.p.id}`);
  }
}
console.log(`\nAPLICADO: ${guardadas} propuestas guardadas${autoCodigo ? ' (nivel codigo auto-aprobado)' : ''}.`);
