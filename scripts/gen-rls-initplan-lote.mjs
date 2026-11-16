// gen-rls-initplan-lote.mjs — DS-46 (#71). Genera, para un LOTE de tablas, la migracion que
// reescribe sus politicas RLS para que las funciones estables sin argumentos de fila
// (auth.uid(), sgc.is_admin(), sgc.tiene_modulo('x'), ...) se evaluen UNA vez por consulta
// (InitPlan) en vez de una vez por fila:  auth.uid()  ->  (select auth.uid()).
// La semantica NO cambia (mismas funciones STABLE, mismos argumentos literales); lo que cambia
// es el plan. Cada lote se prueba con scripts/smoke-ds-rls-initplan.mjs (conteos de filas visibles,
// y UPDATE/DELETE permitidos por persona, antes vs despues).
//
// Uso:  node scripts/gen-rls-initplan-lote.mjs --env dev --lote 1 --tablas a,b,c [--dry]
// Escribe  sql/2026-11-16-ds46-rls-initplan-lote<N>.sql  y la reversa  sql/_reversa/...  (solo lectura de la DB).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { consulta } from './lib/dbq-dev.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const lote = val('--lote'); const tablas = (val('--tablas') || '').split(',').filter(Boolean);
if (!lote || !tablas.length) { console.error('Uso: --env dev --lote N --tablas a,b,c [--dry]'); process.exit(1); }
const env = await resolverEnv(argv);
const lista = tablas.map((t) => `'${t.replace(/'/g, '')}'`).join(',');

const pols = await consulta(env, `
  select c.relname tabla, pol.polname nombre,
         pg_get_expr(pol.polqual, pol.polrelid) using_expr, pg_get_expr(pol.polwithcheck, pol.polrelid) check_expr
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'sgc' and c.relname in (${lista}) order by 1, 2`);

// Funciones sgc.* candidatas: STABLE/IMMUTABLE (nunca volatiles).
const fns = await consulta(env, `select p.proname, (t.typcategory = 'A') es_array, format_type(p.prorettype, null) tipo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
  where n.nspname = 'sgc' and p.provolatile in ('s','i')`);
const estables = new Set(fns.map((f) => f.proname));
// Funciones que devuelven ARRAY: dentro de ANY(...) un (select f()) se leeria como subconsulta, asi que se castea.
const arrays = new Map(fns.filter((f) => f.es_array).map((f) => [f.proname, f.tipo]));

// llamada sin argumentos de fila: argumentos vacios o literales ('x'::text)
const ARG_LIT = String.raw`(?:\s*|\s*'[^']*'(?:::[a-z_ ]+)?(?:\s*,\s*'[^']*'(?:::[a-z_ ]+)?)*\s*)`;
const RE = new RegExp(String.raw`(?<!SELECT )(?<![\w.])(auth\.uid\(\)|sgc\.([a-z_0-9]+)\(${ARG_LIT}\))`, 'g');

let envueltas = 0;
function envolver(expr) {
  if (!expr) return expr;
  return expr.replace(RE, (m, call, fn) => {
    if (m === 'auth.uid()') { envueltas++; return '(select auth.uid())'; }
    if (!estables.has(fn)) return m;
    envueltas++;
    return arrays.has(fn) ? `(select ${m})::${arrays.get(fn)}` : `(select ${m})`;
  });
}

const q = (s) => `"${s.replace(/"/g, '""')}"`;
const sql = [`-- DS-46 (#71) lote ${lote}: politicas RLS con funciones estables en InitPlan (select ...). Generado por scripts/gen-rls-initplan-lote.mjs.`,
  `-- Tablas: ${tablas.join(', ')}. Semantica identica; reversa en sql/_reversa/.`, ''];
const rev = [`-- Reversa de DS-46 lote ${lote}: restaura las expresiones originales de las politicas.`, ''];
let n = 0;
for (const p of pols) {
  const u = envolver(p.using_expr), c = envolver(p.check_expr);
  if (u === p.using_expr && c === p.check_expr) continue;
  const clausulas = (uu, cc) => [uu ? `using (${uu})` : null, cc ? `with check (${cc})` : null].filter(Boolean).join('\n  ');
  sql.push(`alter policy ${q(p.nombre)} on sgc.${p.tabla}\n  ${clausulas(u, c)};\n`);
  rev.push(`alter policy ${q(p.nombre)} on sgc.${p.tabla}\n  ${clausulas(p.using_expr, p.check_expr)};\n`);
  n++;
}
console.log(`lote ${lote}: ${pols.length} politicas en ${tablas.length} tablas, ${n} reescritas, ${envueltas} llamadas envueltas.`);
if (argv.includes('--dry')) process.exit(0);
mkdirSync('sql/_reversa', { recursive: true });
writeFileSync(`sql/2026-11-16-ds46-rls-initplan-lote${lote}.sql`, sql.join('\n'));
writeFileSync(`sql/_reversa/2026-11-16-ds46-rls-initplan-lote${lote}.reversa.sql`, rev.join('\n'));
