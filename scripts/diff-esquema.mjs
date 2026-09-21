// diff-esquema.mjs — BU1 F1.3 — compara el esquema de PROD vs DEV por objeto y
// falla (exit 1) si hay diferencias estructurales. Guard permanente: entra en
// `npm run verify:entornos`. Read-only en ambos proyectos (solo SELECT a catálogos).
//
// Uso:   node scripts/diff-esquema.mjs [--json] [--only <categoria>]
// Env:   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF_DEV (prod = jeeqhgccqefbqilntcpu fijo aquí,
//        único lugar junto a environment.*/.env.local donde el ref de prod es literal a propósito).
//
// Categorías comparadas en el esquema de la app (`sgc`) + objetos relevantes de
// `public`/`storage`/`cron`/`auth`: columnas, constraints, índices, funciones,
// triggers, políticas RLS, tipos/enums, secuencias, grants de RPC, buckets de
// storage + sus políticas, cron.job (command NORMALIZADO por ref), extensiones,
// y catálogos (notif_tipo/roles/modulos como filas).
//
// Diferencias ESPERADAS que no cuentan: filas de `sgc.config_entorno` (valores por
// entorno). Todo lo demás debe ser 0.

import './lib/load-env.mjs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROD = 'jeeqhgccqefbqilntcpu';
const DEV = process.env.SUPABASE_PROJECT_REF_DEV;
if (!TOKEN) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }
if (!DEV) { console.error('NO SUPABASE_PROJECT_REF_DEV (.env.local)'); process.exit(1); }

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

async function runQuery(ref, sql, attempt = 0) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return runQuery(ref, sql, attempt + 1);
  }
  if (!res.ok) {
    // Antes del clon, tablas/esquemas de la app aún no existen en dev → tratar como vacío.
    if (/42P01|3F000|does not exist/.test(text)) return [];
    throw new Error(`HTTP ${res.status} en ${ref}: ${text}`);
  }
  const rows = JSON.parse(text);
  // Cada categoría hace `select json_agg(...) as data` → [{data:[...]}]
  return (rows[0] && rows[0].data) || [];
}

// Normaliza el ref del proyecto en cualquier texto (para comparar cron.command,
// urls embebidas, etc.) → <REF>.
function normRef(s) {
  if (s == null) return s;
  // Normaliza ref del proyecto + fin de línea (autocrlf mete \r en el source de
  // funciones/crons aplicados desde un archivo CRLF; es cosmético).
  return String(s).replaceAll(PROD, '<REF>').replaceAll(DEV, '<REF>').replaceAll('\r', '');
}

// ── Categorías: cada una devuelve filas {k: <clave única>, ...campos} ─────────
const CATS = {
  columnas: `select json_agg(json_build_object(
      'k', table_schema||'.'||table_name||'.'||column_name,
      'v', data_type||'|'||udt_name||'|'||coalesce(column_default,'')||'|'||is_nullable
    ) order by 1) as data
    from information_schema.columns
    where table_schema in ('sgc','public')`,

  constraints: `select json_agg(json_build_object(
      'k', n.nspname||'.'||c.conrelid::regclass::text||'.'||c.conname,
      'v', pg_get_constraintdef(c.oid)
    ) order by 1) as data
    from pg_constraint c join pg_namespace n on n.oid=c.connamespace
    where n.nspname in ('sgc','public')`,

  indices: `select json_agg(json_build_object(
      'k', schemaname||'.'||tablename||'.'||indexname, 'v', indexdef
    ) order by 1) as data
    from pg_indexes where schemaname in ('sgc','public')`,

  funciones: `select json_agg(json_build_object(
      'k', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      'v', md5(replace(pg_get_functiondef(p.oid), chr(13), ''))
    ) order by 1) as data
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('sgc','public')`,

  triggers: `select json_agg(json_build_object(
      'k', n.nspname||'.'||c.relname||'.'||t.tgname, 'v', pg_get_triggerdef(t.oid)
    ) order by 1) as data
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and (n.nspname in ('sgc','public') or (n.nspname='auth' and c.relname='users'))`,

  politicas: `select json_agg(json_build_object(
      'k', schemaname||'.'||tablename||'.'||policyname,
      'v', cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||array_to_string(roles,',')
    ) order by 1) as data
    from pg_policies where schemaname in ('sgc','public','storage')`,

  tipos: `select json_agg(json_build_object(
      'k', n.nspname||'.'||t.typname||'.'||coalesce(e.enumlabel,''),
      'v', t.typtype::text||'|'||coalesce(e.enumsortorder::text,'')
    ) order by 1) as data
    from pg_type t join pg_namespace n on n.oid=t.typnamespace
    left join pg_enum e on e.enumtypid=t.oid
    where n.nspname='sgc' and t.typtype in ('e','c','d')`,

  secuencias: `select json_agg(json_build_object(
      'k', sequence_schema||'.'||sequence_name, 'v', data_type
    ) order by 1) as data
    from information_schema.sequences where sequence_schema in ('sgc','public')`,

  grants_rpc: `select json_agg(json_build_object(
      'k', routine_schema||'.'||routine_name||'.'||grantee||'.'||privilege_type, 'v', 'y'
    ) order by 1) as data
    from information_schema.role_routine_grants
    where routine_schema='sgc' and grantee in ('authenticated','anon','service_role')`,

  buckets: `select json_agg(json_build_object(
      'k', id, 'v', public::text||'|'||coalesce(file_size_limit::text,'')||'|'||coalesce(array_to_string(allowed_mime_types,','),'')
    ) order by 1) as data
    from storage.buckets`,

  extensiones: `select json_agg(json_build_object(
      'k', e.extname, 'v', n.nspname
    ) order by 1) as data
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace`,

  crons: `select json_agg(json_build_object(
      'k', jobname, 'v', schedule||'|'||command
    ) order by 1) as data
    from cron.job`,

  cat_notif_tipo: `select json_agg(json_build_object('k', tipo, 'v', 'y') order by 1) as data from sgc.notif_tipo`,
  cat_roles: `select json_agg(json_build_object('k', nombre, 'v', coalesce(array_to_string(modulos,','),'')) order by 1) as data from sgc.roles`,
  cat_modulos: `select json_agg(json_build_object('k', clave, 'v', 'y') order by 1) as data from sgc.modulos`,
};

// Normaliza el texto de un CHECK constraint: Postgres re-normaliza casts/paréntesis
// al re-crear un constraint desde el output de pg_get_constraintdef (p. ej.
// `(ARRAY[...])::text[]` ↔ `ARRAY[(...)::text]`), diferencia SOLO cosmética e
// imposible de igualar por round-trip. Colapsamos casts, paréntesis y espacios;
// los valores/columnas/operadores se conservan, así que diferencias reales sí saltan.
function normConstraint(v) {
  return String(v).toLowerCase()
    .replace(/::[a-z][a-z0-9_ ]*(\[\])?/g, '') // ::text, ::character varying, ::text[]…
    .replace(/[\s()[\]]/g, '');
}

// Normalizador por categoría (undefined = comparación literal).
const NORMALIZERS = { crons: normRef, constraints: normConstraint };
// Categorías con diferencias ESPERADAS por diseño (no cuentan como fallo).
const EXPECTED_DIFF = new Set(); // config_entorno se maneja aparte (no está en catálogos comparados)

function diffCategory(prodRows, devRows, normFn) {
  const norm = (v) => (normFn ? normFn(v) : v);
  const pm = new Map(prodRows.map((r) => [r.k, norm(r.v)]));
  const dm = new Map(devRows.map((r) => [r.k, norm(r.v)]));
  const soloProd = [], soloDev = [], distintos = [];
  for (const [k, v] of pm) {
    if (!dm.has(k)) soloProd.push(k);
    else if (dm.get(k) !== v) distintos.push(k);
  }
  for (const k of dm.keys()) if (!pm.has(k)) soloDev.push(k);
  return { soloProd, soloDev, distintos, total: soloProd.length + soloDev.length + distintos.length };
}

const cats = only ? { [only]: CATS[only] } : CATS;
const report = {};
let totalDiff = 0;

for (const [name, sql] of Object.entries(cats)) {
  if (!sql) { console.error(`categoría desconocida: ${name}`); process.exit(2); }
  const [prodRows, devRows] = await Promise.all([runQuery(PROD, sql), runQuery(DEV, sql)]);
  const d = diffCategory(prodRows || [], devRows || [], NORMALIZERS[name]);
  report[name] = { prod: (prodRows || []).length, dev: (devRows || []).length, ...d };
  if (!EXPECTED_DIFF.has(name)) totalDiff += d.total;
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('\n📊 diff-esquema PROD vs DEV\n');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('categoría', 18), pad('prod', 6), pad('dev', 6), pad('soloProd', 9), pad('soloDev', 8), 'distintos');
  for (const [name, r] of Object.entries(report)) {
    const flag = r.total ? ' ⚠️' : '';
    console.log(pad(name, 18), pad(r.prod, 6), pad(r.dev, 6), pad(r.soloProd.length, 9), pad(r.soloDev.length, 8), r.distintos.length + flag);
  }
  console.log('');
  for (const [name, r] of Object.entries(report)) {
    if (!r.total) continue;
    console.log(`\n── ${name} ──`);
    if (r.soloProd.length) console.log('  solo en PROD:', r.soloProd.slice(0, 40).join(', ') + (r.soloProd.length > 40 ? ` …(+${r.soloProd.length - 40})` : ''));
    if (r.soloDev.length) console.log('  solo en DEV :', r.soloDev.slice(0, 40).join(', ') + (r.soloDev.length > 40 ? ` …(+${r.soloDev.length - 40})` : ''));
    if (r.distintos.length) console.log('  distintos   :', r.distintos.slice(0, 40).join(', ') + (r.distintos.length > 40 ? ` …(+${r.distintos.length - 40})` : ''));
  }
}

if (totalDiff > 0) {
  console.error(`\n🔴 ${totalDiff} diferencia(s) de esquema PROD vs DEV.`);
  process.exit(1);
}
console.log('\n✓ Sin diferencias de esquema PROD vs DEV.');
