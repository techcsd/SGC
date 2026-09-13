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
// (C) VALOR de los flags: un cambio de valor que un `on conflict do nothing`
//     deja caer EN SILENCIO (el bug BJ3). Si una migración TEMPRANA fijó
//     'X'='false' y una POSTERIOR intenta 'X'='true' pero usa `on conflict do
//     nothing`, el segundo INSERT es un no-op sobre la fila existente: el valor
//     efectivo sigue en 'false' y el feature queda apagado aunque el repo "diga"
//     que se encendió. (Chequear que la fila EXISTA — check A — no basta: existía,
//     con el valor equivocado.) La forma correcta de CAMBIAR el valor es
//     `on conflict (clave) do update set valor = excluded.valor` o un `update
//     sgc.parametros set valor=... where clave=...` explícito.
//
// Casos ACEPTADOS (el conflicto se conoce y la decisión es dejar el valor
// efectivo): se listan aquí con su razón. Un flag fuera de esta lista con
// valores en conflicto ROMPE el build.
const ACCEPTED_FLAG_VALUE_CONFLICTS = new Map([
  // BJ3 — el wizard de conduce web quedó 'false' (AV5) y BJ3 intentó 'true' con
  // `do nothing` (no-op). Decisión de Xaviel (auditoría 13-sep-2026): dejarlo
  // APAGADO por ahora; se encenderá con un `update`/toggle cuando se verifique.
  ['conduce_wizard_web_habilitado', 'BJ3 — apagado a propósito (decisión 13-sep-2026)'],
]);

// Recolecta ESCRITURAS de valor por clave, en orden CRONOLÓGICO. Los archivos de
// sql/ van prefijados por fecha (YYYY-MM-DD-…), así que ordenarlos por nombre =
// ordenarlos por fecha de aplicación.
const writesByKey = new Map(); // key -> [{ value, mode, file }]
function addWrite(key, value, mode, file) {
  if (!writesByKey.has(key)) writesByKey.set(key, []);
  writesByKey.get(key).push({ value, mode, file });
}
const orderedSql = sqlFiles
  .map((f, i) => ({ f, i, base: f.replace(/\\/g, '/').split('/').pop() }))
  .sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.i - b.i));

for (const { f, i } of orderedSql) {
  const sql = sqlText[i];
  const rel = relative(ROOT, f);
  // INSERTs: separa las filas de valores de la cláusula ON CONFLICT.
  const insRe = /insert\s+into\s+sgc\.parametros[\s\S]*?values([\s\S]*?);/gi;
  let m;
  while ((m = insRe.exec(sql)) !== null) {
    const [rowsPart, ocPart = ''] = m[1].split(/on\s+conflict/i);
    let mode;
    if (!/on\s+conflict/i.test(m[1])) mode = 'none';           // insert plano
    else if (/do\s+nothing/i.test(ocPart)) mode = 'nothing';   // no-op si existe
    else if (/do\s+update/i.test(ocPart)) mode = /\bvalor\b/i.test(ocPart) ? 'update-valor' : 'update-other';
    else mode = 'none';
    // Fila = ('clave', 'valor', ...). valor de sgc.parametros es text ⇒ va entre comillas.
    const rowRe = /\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'/gi;
    let r;
    while ((r = rowRe.exec(rowsPart)) !== null) addWrite(r[1], r[2], mode, rel);
  }
  // UPDATE explícito de valor: cambia el valor de verdad.
  const updRe = /update\s+sgc\.parametros\s+set\b([\s\S]*?)\bwhere\b([\s\S]*?);/gi;
  while ((m = updRe.exec(sql)) !== null) {
    const vv = /\bvalor\s*=\s*'([^']*)'/i.exec(m[1]);
    const kk = /\bclave\s*=\s*'([a-z0-9_]+)'/i.exec(m[2]);
    if (vv && kk) addWrite(kk[1], vv[1], 'update-stmt', rel);
  }
}

// Simula el valor efectivo por clave y detecta el cambio dejado caer.
const valueOffenders = []; // flags no aceptados → rompe el build
const valueWarnings = [];  // aceptados + no-flags → aviso informativo
for (const [key, writes] of writesByKey) {
  let effective;
  let exists = false;
  let dropped = null;
  for (const w of writes) {
    switch (w.mode) {
      case 'none':          // insert plano: fija/reemplaza (un dup real reventaría en prod, no es silencioso)
      case 'update-valor':  // on conflict do update set valor=excluded.valor: override correcto
      case 'update-stmt':   // update ... set valor=...: override correcto
        effective = w.value; exists = true; break;
      case 'nothing':       // on conflict do nothing: no cambia una fila existente
      case 'update-other':  // on conflict do update que NO toca valor: tampoco lo cambia
        if (!exists) { effective = w.value; exists = true; }
        else if (w.value !== effective) dropped = { intended: w.value, effective, file: w.file };
        break;
    }
  }
  if (!dropped) continue;
  const entry = { key, ...dropped };
  if (IS_FLAG.test(key)) {
    if (ACCEPTED_FLAG_VALUE_CONFLICTS.has(key)) valueWarnings.push({ ...entry, accepted: ACCEPTED_FLAG_VALUE_CONFLICTS.get(key) });
    else valueOffenders.push(entry);
  } else {
    valueWarnings.push(entry); // no-flag (umbral numérico re-sembrado): solo aviso
  }
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

if (valueOffenders.length) {
  failed = true;
  console.error('\n✗ audit-flags(valor) — FLAGS cuyo cambio de valor se pierde por `on conflict do nothing` (bug BJ3):\n');
  for (const o of valueOffenders) {
    console.error(`   · '${o.key}': una migración intenta valor='${o.intended}', pero el valor efectivo sigue en '${o.effective}'`);
    console.error(`     (${o.file} inserta sobre una fila que ya existía usando ON CONFLICT DO NOTHING → no-op).`);
  }
  console.error('\nPara CAMBIAR el valor de un parámetro usa `on conflict (clave) do update set valor = excluded.valor`\n' +
    'o un `update sgc.parametros set valor=... where clave=...` explícito. Si el valor efectivo ES el deseado,\n' +
    'añade la clave a ACCEPTED_FLAG_VALUE_CONFLICTS en este script con su razón.\n');
} else {
  console.log('✓ audit-flags(valor): ningún flag pierde su cambio de valor por on-conflict-do-nothing.');
}
for (const w of valueWarnings) {
  if (w.accepted) {
    console.log(`ℹ flag '${w.key}': conflicto de valor ACEPTADO — efectivo '${w.effective}', intento '${w.intended}' — ${w.accepted}.`);
  } else {
    console.log(`ℹ parámetro '${w.key}' (no-flag): el valor '${w.intended}' de ${w.file} no aplica (efectivo '${w.effective}', on-conflict-do-nothing).`);
  }
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
