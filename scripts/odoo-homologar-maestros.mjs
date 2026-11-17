// DS-07 (parte 2) -- propone la homologacion de CATEGORIAS y UNIDADES de SGC con las de Odoo (staging, SOLO LECTURA) y la deja para
// aprobacion humana en Tecnologia > Homologacion con Odoo. Nada se vincula aqui: solo se escriben propuestas (estado 'propuesta').
//   nombre     : nombre normalizado identico
//   sinonimo   : tabla de sinonimos de unidades (Metro = m = Meter(s)...) o categoria con la misma ultima parte de la ruta
//   similitud  : trigramas (Jaccard) >= 0.55
// Dry-run por defecto (imprime el informe). --apply guarda las propuestas en dev.
//   node scripts/odoo-homologar-maestros.mjs --env dev [--apply]
import { resolverEnv } from './lib/entorno.mjs';
import { consulta } from './lib/dbq-dev.mjs';
import { conectar } from './lib/odoo-staging.mjs';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);
if (env.entorno !== 'dev') { console.error('Solo dev (staging de Odoo).'); process.exit(1); }
const apply = argv.includes('--apply');
const lit = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const trig = (s) => { const t = `  ${norm(s)} `; const set = new Set(); for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3)); return set; };
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return a.size && b.size ? n / (a.size + b.size - n) : 0; };

// Sinonimos de unidades (SGC -> nombres/abreviaturas que Odoo suele usar). Solo ayudan a PROPONER; la decision es humana.
const SIN = {
  par: ['pair', 'par'], docena: ['dozen', 'docena'], kg: ['kg'], lb: ['lb'], tonelada: ['t', 'ton', 'tonne'], m: ['m'], m2: ['m2', 'm²'], m3: ['m3', 'm³'],
  litro: ['l', 'litre', 'liter'], galon: ['gal', 'us gal', 'gallon'], pie: ['ft', 'foot'], pie2: ['ft2', 'ft²'], pie3: ['ft3', 'ft³'], yarda: ['yd', 'yard'],
  pulgada: ['in', 'inch'], unidad: ['unit', 'units', 'unidad', 'unidades'], paquete: ['pack', 'paquete'], caja: ['box', 'caja'],
};

const { kw } = await conectar();
const [inst] = await consulta(env, 'select id from sgc.odoo_instancias where habilitada limit 1');
if (!inst) throw new Error('No hay instancia habilitada en dev');

const catsOdoo = await kw('product.category', 'search_read', [[]], { fields: ['id', 'name', 'complete_name'], limit: 2000 });
const uomsOdoo = await kw('uom.uom', 'search_read', [[['active', '=', true]]], { fields: ['id', 'name', 'category_id', 'factor', 'uom_type'], limit: 500 });
const catsSgc = await consulta(env, 'select id, nombre from sgc.categorias_inventario where activo and odoo_id is null');
const uniSgc = await consulta(env, 'select id, codigo, nombre from sgc.unidades where activo and odoo_id is null');
const yaCat = new Set((await consulta(env, 'select odoo_id from sgc.categorias_inventario where odoo_id is not null')).map((r) => Number(r.odoo_id)));
const yaUni = new Set((await consulta(env, 'select odoo_id from sgc.unidades where odoo_id is not null')).map((r) => Number(r.odoo_id)));

function proponer(sgc, odoo, nombreSgc, nombreOdoo, sinonimos) {
  const propuestas = [];
  const odooTri = odoo.map((o) => [o, trig(nombreOdoo(o))]);
  for (const s of sgc) {
    const ns = norm(nombreSgc(s));
    let hit = odoo.find((o) => norm(nombreOdoo(o)) === ns); let metodo = 'nombre'; let score = 0.99;
    if (!hit && sinonimos) {
      const sin = sinonimos(s).map(norm);
      hit = odoo.find((o) => sin.includes(norm(o.name))); metodo = 'sinonimo'; score = 0.85;
    }
    if (!hit) {
      const ts = trig(nombreSgc(s)); let mejor = null; let ms = 0;
      for (const [o, to] of odooTri) { const sc = jaccard(ts, to); if (sc > ms) { ms = sc; mejor = o; } }
      if (mejor && ms >= 0.55) { hit = mejor; metodo = 'similitud'; score = Math.round(ms * 1000) / 1000; }
    }
    if (hit) propuestas.push({ s, o: hit, metodo, score });
  }
  // Un elemento de Odoo no puede ir a dos de SGC: se queda el de mayor score.
  const usados = new Map(); for (const p of propuestas.sort((a, b) => b.score - a.score)) if (!usados.has(p.o.id)) usados.set(p.o.id, p);
  return [...usados.values()];
}

const libresCat = catsOdoo.filter((c) => !yaCat.has(c.id));
const libresUni = uomsOdoo.filter((u) => !yaUni.has(u.id));
const pCat = proponer(catsSgc, libresCat, (c) => c.nombre, (o) => o.name,
  null).concat([]);
// categoria: tambien se acepta la ultima parte de la ruta completa de Odoo (All / Construccion / Cemento -> Cemento): ya la cubre 'name'.
const pUni = proponer(uniSgc, libresUni, (u) => u.nombre.replace(/\s*\(.*\)\s*$/, ''), (o) => o.name, (u) => [u.codigo, ...(SIN[u.codigo] ?? [])]);

const informe = (titulo, total, libres, props, linea) => {
  console.log(`[${env.entorno}] ${titulo}: SGC sin vincular ${total} | Odoo libres ${libres} | propuestas ${props.length} | sin contraparte ${total - props.length}`);
  for (const m of ['nombre', 'sinonimo', 'similitud']) console.log(`   ${m}: ${props.filter((p) => p.metodo === m).length}`);
  for (const p of props.slice(0, 6)) console.log(`   ${p.metodo.padEnd(9)} ${p.score} | ${linea(p)}`);
};
informe('categorias', catsSgc.length, libresCat.length, pCat, (p) => `${p.s.nombre} -> ${p.o.complete_name ?? p.o.name}`);
informe('unidades', uniSgc.length, libresUni.length, pUni, (p) => `${p.s.nombre} -> ${p.o.name} (${p.o.category_id?.[1] ?? '?'})`);
if (!apply) { console.log('\n(dry-run: nada escrito; usa --apply)'); process.exit(0); }

const filas = [
  ...pCat.map((p) => ({ tipo: 'categoria', sgc: p.s.id, o: p.o.id, nombre: p.o.name, detalle: p.o.complete_name ?? p.o.name, datos: {}, metodo: p.metodo, score: p.score })),
  ...pUni.map((p) => ({ tipo: 'unidad', sgc: p.s.id, o: p.o.id, nombre: p.o.name, detalle: p.o.category_id?.[1] ?? null, datos: { factor: p.o.factor, tipo_odoo: p.o.uom_type }, metodo: p.metodo, score: p.score })),
];
for (const f of filas) {
  await consulta(env, `insert into sgc.odoo_homologacion_maestros(odoo_instancia_id, tipo, sgc_id, odoo_id, nombre_odoo, detalle_odoo, datos, metodo, score)
    values (${lit(inst.id)}, ${lit(f.tipo)}, ${f.sgc}, ${f.o}, ${lit(f.nombre)}, ${f.detalle == null ? 'null' : lit(f.detalle)}, ${lit(JSON.stringify(f.datos))}::jsonb, ${lit(f.metodo)}, ${f.score})
    on conflict (odoo_instancia_id, tipo, sgc_id, odoo_id) do nothing`);
}
console.log(`\nGuardadas ${filas.length} propuestas (estado 'propuesta'; nada vinculado).`);
