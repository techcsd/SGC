// audit-flags-exports-muertos.mjs — BJ3 / Regla 6 del checklist de migraciones.
//
// Dos deudas que la Ronda BJ hizo explícitas:
//   (A) Un FLAG detrás de sgc.parametros que se LEE pero cuya FILA nunca se creó
//       por una migración = feature apagado por accidente (fue BJ3:
//       `conduce_wizard_web_habilitado` — el gate leía un parámetro inexistente,
//       devolvía false y el wizard llevaba semanas apagado sin que nadie lo notara).
//   (B) Un EXPORT de servicio sin NINGÚN llamador = código muerto (fue BJ3:
//       `crearConduceSimple()` llevaba semanas con cero llamadores).
//
// Escaneo estático (no necesita DB). Corre en prebuild como los demás guardas.
// Uso:  node scripts/audit-flags-exports-muertos.mjs
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE_FILE = join(ROOT, 'scripts', '.dead-exports-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');
const SQL_DIR = join(ROOT, 'sql');
const SRC_DIR = join(ROOT, 'src');

// ── util: recolecta archivos por extensión ─────────────────────────────────
function walk(dir, exts, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, exts, acc); continue; }
    if (exts.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}

const sqlFiles = walk(SQL_DIR, ['.sql']);
const srcTs = walk(SRC_DIR, ['.ts']).filter((f) => !f.endsWith('.spec.ts'));
const srcHtml = walk(SRC_DIR, ['.html']);
const sqlText = sqlFiles.map((f) => readFileSync(f, 'utf8'));

// ════════════════════════════════════════════════════════════════════════════
// (A) Flags de sgc.parametros: todo `clave` que se LEE debe tener un INSERT.
// ════════════════════════════════════════════════════════════════════════════
const insertedKeys = new Set();
// insert into sgc.parametros (...) values ('key', ...), ('key2', ...) ...
for (const sql of sqlText) {
  const re = /insert\s+into\s+sgc\.parametros[\s\S]*?values([\s\S]*?);/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const block = m[1];
    const keyRe = /\(\s*'([a-z0-9_]+)'/gi;
    let k;
    while ((k = keyRe.exec(block)) !== null) insertedKeys.add(k[1]);
  }
}

const readKeys = new Map(); // key -> where seen
function noteRead(key, where) {
  if (!readKeys.has(key)) readKeys.set(key, where);
}
// En SQL: where ... clave = 'key'  |  p.clave = 'key'
for (let i = 0; i < sqlText.length; i++) {
  const re = /\bclave\s*=\s*'([a-z0-9_]+)'/gi;
  let m;
  while ((m = re.exec(sqlText[i])) !== null) noteRead(m[1], relative(ROOT, sqlFiles[i]));
}
// En TS: .eq('clave', 'key')
for (const f of srcTs) {
  const txt = readFileSync(f, 'utf8');
  const re = /\.eq\(\s*'clave'\s*,\s*'([a-z0-9_]+)'\s*\)/gi;
  let m;
  while ((m = re.exec(txt)) !== null) noteRead(m[1], relative(ROOT, f));
}

// Solo los FLAGS booleanos que ENCIENDEN un feature deben tener fila obligatoria:
// su ausencia = feature apagado por accidente (el caso BJ3). Los umbrales/params
// numéricos se leen con `coalesce(..., <default>)` y su ausencia = usar el default
// (patrón legítimo), así que NO se exigen. Heurística por sufijo de nombre.
const IS_FLAG = /_(habilitado|activo|enabled|flag)$/;
const flagOffenders = [];
for (const [key, where] of readKeys) {
  if (!IS_FLAG.test(key)) continue;
  if (!insertedKeys.has(key)) flagOffenders.push({ key, where });
}

// ════════════════════════════════════════════════════════════════════════════
// (B) Exports de servicios sin llamadores. Alcance: métodos PÚBLICOS de
//     src/shared/services/*.service.ts. Un método sin referencias fuera de su
//     propio archivo = código muerto.
// ════════════════════════════════════════════════════════════════════════════
const serviceFiles = srcTs.filter((f) => /shared[\\/]services[\\/].*\.service\.ts$/.test(f));
// Corpus de búsqueda de referencias: todo TS + HTML MENOS el archivo declarante.
const allRefFiles = [...srcTs, ...srcHtml];
const refCache = new Map();
function fileText(f) {
  if (!refCache.has(f)) refCache.set(f, readFileSync(f, 'utf8'));
  return refCache.get(f);
}

// Lifecycle / cosas que se invocan por framework, no por nombre en el código.
const IGNORE = new Set([
  'constructor', 'ngOnInit', 'ngOnDestroy', 'ngAfterViewInit', 'ngOnChanges',
  'ngAfterViewChecked', 'ngAfterContentInit', 'ngDoCheck',
]);

const deadOffenders = [];
for (const f of serviceFiles) {
  const txt = fileText(f);
  // Métodos públicos: `async name(` o `name(` a nivel de miembro, NO precedidos
  // por private/protected/#, y NO get/set. Heurística por líneas.
  const lines = txt.split('\n');
  const methodRe = /^\s*(?:public\s+)?(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
  for (const line of lines) {
    if (/\b(private|protected|readonly|get |set )\b/.test(line)) continue;
    if (line.trimStart().startsWith('#')) continue;
    if (/\b(if|for|while|switch|catch|return|await|const|let|var)\b/.test(line)) continue;
    const m = methodRe.exec(line);
    if (!m) continue;
    const name = m[1];
    if (IGNORE.has(name)) continue;
    // ¿Se referencia `.name(` o `.name` en algún OTRO archivo?
    const refRe = new RegExp(`\\.${name}\\b`);
    let referenced = false;
    for (const rf of allRefFiles) {
      if (rf === f) continue;
      if (refRe.test(fileText(rf))) { referenced = true; break; }
    }
    if (!referenced) deadOffenders.push(`${relative(ROOT, f).replace(/\\/g, '/')}::${name}`);
  }
}

// Ratchet: hay una DEUDA legacy conocida (métodos muertos preexistentes) en un
// baseline versionado. El guarda solo FALLA por dead-exports NUEVOS (no en el
// baseline) — así se evita el tercer `crearConduceSimple`, sin obligar a limpiar
// de golpe todo el backlog. `--update-baseline` regenera el archivo tras una
// limpieza intencional.
let baseline = [];
if (existsSync(BASELINE_FILE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch { baseline = []; }
}
const baselineSet = new Set(baseline);
const currentSet = new Set(deadOffenders);
if (UPDATE_BASELINE) {
  writeFileSync(BASELINE_FILE, JSON.stringify([...currentSet].sort(), null, 2) + '\n');
  console.log(`✓ baseline de dead-exports regenerado (${currentSet.size} entradas).`);
  process.exit(0);
}
const newDead = deadOffenders.filter((d) => !baselineSet.has(d));
const resolvedDebt = baseline.filter((b) => !currentSet.has(b)); // limpiados: se pueden quitar del baseline

// ── Reporte ─────────────────────────────────────────────────────────────────
let failed = false;

if (flagOffenders.length) {
  failed = true;
  console.error('\n✗ audit-flags — parámetros de sgc.parametros LEÍDOS pero SIN fila creada por migración (Regla 6):\n');
  for (const o of flagOffenders) console.error(`   · '${o.key}'  (leído en ${o.where})`);
  console.error('\nCada flag DEBE nacer con su INSERT en sgc.parametros en la misma migración,\n' +
    'o el gate lee un parámetro inexistente y el feature queda apagado por accidente.\n');
} else {
  console.log('✓ audit-flags: todo parámetro leído tiene su fila en sgc.parametros.');
}

if (newDead.length) {
  failed = true;
  console.error('\n✗ audit-exports — métodos públicos de servicios NUEVOS sin ningún llamador (código muerto, Regla 6):\n');
  for (const o of newDead) console.error(`   · ${o.replace('::', ' → ')}()`);
  console.error('\nBórralos antes de subir. Si de verdad se usan por vía dinámica, documenta por qué\n' +
    'y corre `node scripts/audit-flags-exports-muertos.mjs --update-baseline`.\n');
} else {
  console.log(`✓ audit-exports: sin dead-exports nuevos (deuda legacy en baseline: ${baseline.length}).`);
}
if (resolvedDebt.length) {
  console.log(`ℹ ${resolvedDebt.length} entrada(s) del baseline ya tienen llamador; corre --update-baseline para depurarlo.`);
}

process.exit(failed ? 1 : 0);
