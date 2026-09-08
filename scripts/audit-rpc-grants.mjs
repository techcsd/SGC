// audit-rpc-grants.mjs — BM4 (PROMPT-40). Hermano del auditor de buckets.
//
// Por qué existe: AW3 creó una SOBRECARGA nueva de registrar_combustible_app (20
// args, +p_confirmado) y sólo otorgó sus ayudantes → la RPC de 20 args se quedó
// SIN `grant execute ... to authenticated` en sql/. Hoy funciona por el EXECUTE TO
// PUBLIC por defecto de Postgres; si alguien lo revoca (o ya lo revocó en prod
// fuera de sql/), el resultado es `42501 permission denied for function` → la app
// lo pinta como "Problema del sistema" en el intento 1. Este patrón (sobrecarga
// nueva sin grant) ya se repitió; una regla que depende de recordarla no es regla.
//
// Qué chequea: para cada RPC que el CLIENTE llama por `.rpc('X')` (web + csd-app),
// la sobrecarga VIVA —la de MAYOR aridad creada en sql/— debe tener un
// `grant execute on function sgc.X(...) to authenticated` de ESA misma aridad.
// (El patrón aditivo del repo añade params con DEFAULT al final: la de mayor aridad
//  es la que PostgREST resuelve.) Cuenta PARÁMETROS, no tipos → inmune a int/integer.
//
// Escaneo ESTÁTICO (no necesita DB) → corre en prebuild. `--report` sólo lista.
//
// Uso:  node scripts/audit-rpc-grants.mjs [--report]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WEB_ROOT = process.cwd();
const SQL_DIR = join(WEB_ROOT, 'sql');
const REPORT_ONLY = process.argv.includes('--report');

const APP_SRC_CANDIDATES = [
  join(WEB_ROOT, '..', '..', 'dev2', 'csd-app', 'src'),
  join(WEB_ROOT, '..', 'csd-app', 'src'),
  join(WEB_ROOT, 'csd-app', 'src'),
];
const SRC_DIRS = [join(WEB_ROOT, 'src')];
for (const c of APP_SRC_CANDIDATES) if (existsSync(c)) { SRC_DIRS.push(c); break; }

// Cuenta parámetros dentro del grupo de paréntesis que arranca en `openIdx`
// (índice del '('). Devuelve {count, endIdx}. Comas a profundidad 1 = separadores.
function countParams(text, openIdx) {
  let depth = 0, count = 0, seen = false, i = openIdx;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) break; }
    else if (ch === ',' && depth === 1) count++;
    else if (depth === 1 && !/\s/.test(ch)) seen = true;
  }
  return { count: seen ? count + 1 : 0, endIdx: i };
}

// Escanea sql/ por creates y grants. La aridad VIVA de una RPC = la del create en
// la migración MÁS RECIENTE (nombres de archivo son fechados → orden lexicográfico).
// Usar el MÁXIMO histórico daba falsos positivos: una sobrecarga vieja de mayor
// aridad, ya reemplazada por una menor en prod, seguía en el texto de sql/.
const createdLiveArity = new Map(); // name -> aridad del create más reciente
const grantedArities = new Map();   // name -> Set(aridades con grant a authenticated)
const grantedAny = new Set();       // name con grant SIN firma (función única → cubre su overload)

const CREATE_RE = /create\s+(?:or\s+replace\s+)?function\s+sgc\.([a-z0-9_]+)\s*\(/gis;
// Grant con firma `(…)` O sin firma (`... to authenticated`): ambos son válidos.
const GRANT_RE = /grant\s+execute\s+on\s+function\s+sgc\.([a-z0-9_]+)\s*(\(|to\b)/gis;

for (const f of (existsSync(SQL_DIR) ? readdirSync(SQL_DIR).filter((x) => x.endsWith('.sql')).sort() : [])) {
  const sql = readFileSync(join(SQL_DIR, f), 'utf8');

  let m;
  CREATE_RE.lastIndex = 0;
  while ((m = CREATE_RE.exec(sql)) !== null) {
    const name = m[1];
    const { count } = countParams(sql, m.index + m[0].length - 1);
    // Archivos en orden ascendente → el último create visto es el más reciente.
    createdLiveArity.set(name, count);
  }

  GRANT_RE.lastIndex = 0;
  while ((m = GRANT_RE.exec(sql)) !== null) {
    const name = m[1];
    if (m[2] === '(') {
      const from = m.index + m[0].length - 1;
      const { count, endIdx } = countParams(sql, from);
      const tail = sql.slice(endIdx, endIdx + 160);
      if (/\bauthenticated\b/i.test(tail)) {
        if (!grantedArities.has(name)) grantedArities.set(name, new Set());
        grantedArities.get(name).add(count);
      }
    } else {
      // Grant sin firma: sólo legal si la función es única → cubre su único overload.
      const tail = sql.slice(m.index, m.index + 160);
      if (/\bauthenticated\b/i.test(tail)) grantedAny.add(name);
    }
  }
}

// RPCs que el cliente llama por nombre (web + app).
const clientRpcs = new Set();
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
for (const root of SRC_DIRS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const txt = readFileSync(file, 'utf8');
    for (const m of txt.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) clientRpcs.add(m[1]);
  }
}

// Cruce: la sobrecarga VIVA (mayor aridad creada) de cada RPC cliente necesita un
// grant a authenticated de esa aridad.
// Dos niveles de confianza (un análisis ESTÁTICO no puede saber la firma viva de
// prod: sql/ puede tener un create más nuevo aún NO desplegado):
//   · zeroGrant (ALTA confianza, ROMPE el build) — la RPC no tiene NINGÚN grant a
//     authenticated en sql/ (ni con firma ni sin ella). Es un hueco inequívoco del
//     repo: si el EXECUTE TO PUBLIC por defecto se revoca, la RPC muere con 42501.
//   · arityMismatch (BAJA confianza, sólo `--report`) — hay grant a authenticated
//     pero no en la aridad del create más reciente. Puede ser un hueco real (BM4) o
//     un create nuevo sin desplegar. NO rompe: verificar la firma VIVA contra prod
//     (pg_proc) antes de otorgar (ver scripts/audit-rpc-grants-db o el CHECKLIST).
const zeroGrant = [];
const arityMismatch = [];
for (const name of clientRpcs) {
  if (!createdLiveArity.has(name)) continue; // no está en sql/ (built-in u otro schema)
  if (grantedAny.has(name)) continue; // grant sin firma cubre el único overload
  const grants = grantedArities.get(name);
  if (!grants || grants.size === 0) { zeroGrant.push({ name }); continue; }
  const arity = createdLiveArity.get(name);
  if (!grants.has(arity)) arityMismatch.push({ name, arity, grants: [...grants].sort((a, b) => a - b) });
}

if (REPORT_ONLY && arityMismatch.length) {
  console.error('\n⚠ audit-rpc-grants (report) — grant a authenticated existe pero no en la aridad del create más reciente de sql/ (verificar firma viva contra prod):\n');
  for (const m of arityMismatch) console.error(`   · sgc.${m.name}(create más reciente: ${m.arity} args)  — grants a authenticated: ${m.grants.join(', ')}`);
}

if (!zeroGrant.length) {
  console.log(`✓ audit-rpc-grants: ${clientRpcs.size} RPC(s) del cliente; todas con al menos un grant a authenticated en sql/.`);
  process.exit(0);
}

console.error('\n✗ audit-rpc-grants — RPC(s) que el cliente llama pero SIN ningún grant a authenticated en sql/ (BM4):\n');
for (const m of zeroGrant) console.error(`   · sgc.${m.name}`);
console.error(
  '\nEstas RPC sólo son ejecutables por el EXECUTE TO PUBLIC por defecto de Postgres.\n' +
  'Si se revoca (o ya se revocó en prod fuera de sql/) → 42501 permission denied for\n' +
  'function → la app lo pinta "Problema del sistema" en el intento 1. Añade el grant\n' +
  'explícito de la firma viva (verifícala en prod):\n' +
  '  grant execute on function sgc.<name>(<args…>) to authenticated, service_role;\n' +
  'Ver docs/CHECKLIST-MIGRACIONES.md (BM4).\n',
);
process.exit(1);
