// audit-buckets-upsert-policy.mjs — BI1 (regla 5 del checklist, ver
// docs/CHECKLIST-MIGRACIONES.md). Regla PERMANENTE: todo bucket de Storage usado
// con `upsert: true` NACE con política INSERT *y* UPDATE en `storage.objects`.
//
// Por qué existe: `sgc-bitacora` fue el ÚNICO de 9 buckets de campo que nunca
// recibió su política UPDATE. La app sube las fotos con upsert:true a rutas
// deterministas; el 1er intento entra (INSERT), pero todo REINTENTO re-sube la
// misma ruta → Storage ejecuta un UPDATE → sin política, "new row violates
// row-level security policy". La data del ingeniero quedó atascada desde el 20-ago.
// La regla ya estaba escrita en DOS migraciones (flota-documentos, bg4-retiro) y
// aun así se saltó un bucket → una regla que depende de recordarla no es una regla.
//
// Escaneo ESTÁTICO (no necesita DB) → corre en prebuild como los demás guardas.
// Cruza los buckets usados con upsert:true en AMBOS repos (web + csd-app) contra
// las políticas UPDATE declaradas en sql/. Rompe el build si falta una.
//
// Uso:  node scripts/audit-buckets-upsert-policy.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WEB_ROOT = process.cwd();
const SQL_DIR = join(WEB_ROOT, 'sql');
// El repo hijo (csd-app) es hermano de SGC: ...\dev\SGC y ...\dev2\csd-app
const APP_SRC_CANDIDATES = [
  join(WEB_ROOT, '..', '..', 'dev2', 'csd-app', 'src'),
  join(WEB_ROOT, '..', 'csd-app', 'src'),
  join(WEB_ROOT, 'csd-app', 'src'),
];
const SRC_DIRS = [join(WEB_ROOT, 'src')];
for (const c of APP_SRC_CANDIDATES) if (existsSync(c)) { SRC_DIRS.push(c); break; }

// ── 1) Buckets declarados (insert into storage.buckets ... values ('X', ...)) ──
function readSql() {
  try { return readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')); } catch { return []; }
}
const sqlFiles = readSql();
const declaredBuckets = new Set();
const BUCKET_DECL = /insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([a-z0-9_-]+)'/gis;
for (const f of sqlFiles) {
  const sql = readFileSync(join(SQL_DIR, f), 'utf8');
  let m; BUCKET_DECL.lastIndex = 0;
  while ((m = BUCKET_DECL.exec(sql)) !== null) declaredBuckets.add(m[1]);
}

// ── 2) Buckets con política UPDATE (for update ... bucket_id = 'X' | ANY(ARRAY[...])) ──
const bucketsWithUpdate = new Set();
for (const f of sqlFiles) {
  const sql = readFileSync(join(SQL_DIR, f), 'utf8').toLowerCase();
  // Cada bloque `create policy ... for update ...` hasta el `;`
  const POLICY = /create\s+policy[^;]*?for\s+update[^;]*?;/gis;
  let pm; POLICY.lastIndex = 0;
  while ((pm = POLICY.exec(sql)) !== null) {
    const block = pm[0];
    const BID = /bucket_id\s*=\s*'([a-z0-9_-]+)'/g;
    let bm; while ((bm = BID.exec(block)) !== null) bucketsWithUpdate.add(bm[1]);
    // Formato ANY (ARRAY['a','b'])
    const anyArr = block.match(/bucket_id\s*=\s*any\s*\(\s*array\[([^\]]+)\]/);
    if (anyArr) for (const q of anyArr[1].matchAll(/'([a-z0-9_-]+)'/g)) bucketsWithUpdate.add(q[1]);
  }
}

// ── 3) Buckets usados con upsert:true en el código (evidencia por grep) ──────────
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
const upsertBuckets = new Map(); // bucket -> evidencia (archivo)
function note(b, where) { if (declaredBuckets.has(b) && !upsertBuckets.has(b)) upsertBuckets.set(b, where); }

for (const root of SRC_DIRS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const txt = readFileSync(file, 'utf8');
    const rel = file.replace(WEB_ROOT, '.').replace(/\\/g, '/');
    // Consts de bucket declarados en el archivo: `const BUCKET = 'sgc-bitacora'`.
    const fileConsts = new Map();
    for (const m of txt.matchAll(/(?:const\s+)?([A-Za-z0-9_]*BUCKET[A-Za-z0-9_]*)\s*=\s*'([a-z0-9_-]+)'/g)) fileConsts.set(m[1], m[2]);
    // (a) Invariante del outbox: toda foto con `bucket: 'X'` (o `bucket: BUCKET`) se
    //     sube por el uploader del sync con upsert:true (sync.service.ts). Cuenta siempre.
    //     Resolver el const es lo que atrapa sgc-bitacora (bucket: BUCKET, no literal).
    for (const m of txt.matchAll(/bucket:\s*'([a-z0-9_-]+)'/g)) note(m[1], rel);
    for (const m of txt.matchAll(/bucket:\s*([A-Za-z0-9_]*BUCKET[A-Za-z0-9_]*)\b/g)) {
      const b = fileConsts.get(m[1]); if (b) note(b, rel);
    }
    // (b) Subidas directas con upsert:true → SÓLO el bucket ligado a ESA subida
    //     (la .from(...) que precede al upsert:true), no cualquier .from del archivo
    //     (evita falsos positivos con buckets que el archivo sólo LEE).
    if (/upsert:\s*true/.test(txt)) {
      // Consts de bucket declarados en el archivo (const X_BUCKET = 'y')
      const consts = new Map();
      for (const m of txt.matchAll(/(?:const\s+)?([A-Z0-9_]*BUCKET[A-Z0-9_]*)\s*=\s*'([a-z0-9_-]+)'/g)) consts.set(m[1], m[2]);
      for (const m of txt.matchAll(/upsert:\s*true/g)) {
        const window = txt.slice(Math.max(0, m.index - 400), m.index);
        // último .from(...) antes del upsert:true
        let last = null;
        for (const f of window.matchAll(/\.from\(\s*(?:'([a-z0-9_-]+)'|([A-Z0-9_]*BUCKET[A-Z0-9_]*))\s*\)/g)) last = f;
        if (!last) continue;
        const bucket = last[1] || consts.get(last[2]);
        if (bucket) note(bucket, rel);
      }
    }
  }
}

// ── 4) Cruce: cada bucket con upsert debe tener política UPDATE ─────────────────
const missing = [];
for (const [b, where] of upsertBuckets) {
  if (!bucketsWithUpdate.has(b)) missing.push({ bucket: b, where });
}

if (!missing.length) {
  console.log(`✓ audit-buckets: ${upsertBuckets.size} bucket(s) con upsert:true, todos con política UPDATE.`);
  process.exit(0);
}

console.error('\n✗ audit-buckets — bucket(s) usados con upsert:true SIN política UPDATE en storage.objects (regla 5):\n');
for (const m of missing) console.error(`   · '${m.bucket}'  (evidencia: ${m.where})`);
console.error(
  '\nCada bucket que reciba subidas con upsert:true necesita política INSERT *y* UPDATE\n' +
  "(patrón: create policy ... for update ... using/with check (bucket_id = 'X')).\n" +
  'Sin la UPDATE, el REINTENTO de un envío (re-upload de la misma ruta) revienta con\n' +
  '"new row violates row-level security policy". Ver docs/CHECKLIST-MIGRACIONES.md (regla 5).\n',
);
process.exit(1);
