// scripts/release-check.mjs — CP5 (docs/STAGING.md) — gate de "dev es staging real".
// Corre ANTES de todo PR `dev → main`. No reemplaza el flujo de BU1 (regla 18) —
// lo CIERRA: hasta ahora nada impedía mandar `dev → main` sin que la migración se
// hubiera probado de verdad, sin un registro humano de quién probó qué versión, ni
// sin que los evals de Compa hubieran corrido verdes tras tocar la edge `assistant`.
//
//   node scripts/release-check.mjs --env dev --version 1.191.0
//   node scripts/release-check.mjs --env dev --version 1.191.0 --yes          (no interactivo)
//   node scripts/release-check.mjs --env dev --version 1.191.0 --skip-build   (SOLO debugging local de este script — NUNCA para un release real)
//   node scripts/release-check.mjs --env dev --version 1.191.0 --dias 21      (ventana del heurístico de "archivos tocados recientemente"; default 14)
//
// --env: el entorno CUYO ESTADO se audita (ledger de migraciones, etc.) — en el
// flujo normal (feature/* → dev → main) siempre es `dev`, porque lo que se está
// verificando es "¿dev ya vivió y probó esto antes de ir a prod?". Reusa
// resolverEnv (igual que el resto de scripts/*): sin --env no corre.
//
// 5 checks, cada uno imprime PASS/FAIL/SKIP (nunca un salto silencioso):
//   1. Dev tuvo tiempo de "respirar" (>=24h desde el último commit de la rama dev)
//      O hay un OK explícito de Xaviel en qa/release-<version>.md (línea que empieza
//      con "OK:" o "**OK de Xaviel**").
//   2. Las migraciones sql/ tocadas recientemente (heurístico: desde el último tag
//      de git, o si no hay tags, en los últimos --dias días) están en el ledger
//      sgc.migraciones_aplicadas del entorno auditado, CON el mismo checksum.
//   3. qa/release-<version>.md existe y no es un stub (registro humano de prueba).
//   4. Si supabase/functions/assistant/index.ts cambió en la misma ventana: los
//      evals de Compa (qa/compa-evals-<entorno>.json, generado por
//      scripts/compa-evals.mjs) están frescos (<24h) y 100% verdes. Si NO cambió,
//      se imprime SKIP explícito (nunca se omite en silencio).
//   5. `npm run build` (y `npm run test:unit`/`npm test` si existe) salen en verde.
//      Es el check más lento → va último. `--skip-build` lo salta (debugging local
//      de release-check.mjs únicamente).
//
// Exit code: 1 si algún check es FAIL. 0 si todo es PASS/SKIP.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const VERSION = flag('--version');
if (!VERSION || typeof VERSION !== 'string') {
  console.error('🔴 falta --version X.Y.Z');
  console.error('Uso: node scripts/release-check.mjs --env dev --version X.Y.Z [--yes] [--skip-build] [--dias N]');
  process.exit(1);
}
const SKIP_BUILD = argv.includes('--skip-build');
const DIAS = Number(flag('--dias')) || 14;

const env = await resolverEnv(argv); // exige --env dev|prod; confirma banner si prod

const resultados = []; // { id, titulo, estado: 'PASS'|'FAIL'|'SKIP', detalle: string[] }
function reportar(id, titulo, estado, detalle = []) {
  resultados.push({ id, titulo, estado, detalle: Array.isArray(detalle) ? detalle : [detalle] });
  const icono = estado === 'PASS' ? '✅' : estado === 'SKIP' ? '⏭ ' : '🔴';
  console.log(`\n${icono} [${id}] ${titulo} — ${estado}`);
  for (const l of resultados[resultados.length - 1].detalle) console.log(`     ${l}`);
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function ultimoTag() {
  return git('describe --tags --abbrev=0');
}

// Heurístico compartido (checks 2 y 4): archivos tocados en pathSpec desde el
// último tag de git, o si no hay tags (hoy no hay ninguno en este repo), en los
// últimos --dias días. El día que el repo adopte tags de versión, este heurístico
// se vuelve automáticamente más preciso sin tocar el script.
function archivosCambiadosDesde(pathSpec) {
  const tag = ultimoTag();
  let out;
  if (tag) out = git(`diff --name-only --diff-filter=AM ${tag}..HEAD -- ${pathSpec}`);
  else out = git(`log --since="${DIAS} days ago" --name-only --diff-filter=AM --pretty=format: -- ${pathSpec}`);
  if (!out) return { archivos: [], referencia: tag ? `tag ${tag}` : `últimos ${DIAS} días (sin tags en el repo)` };
  const archivos = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
  return { archivos, referencia: tag ? `tag ${tag}` : `últimos ${DIAS} días (sin tags en el repo)` };
}

// ── Check 1 — dev respiró, o hay OK explícito ────────────────────────────────
function check1() {
  const ts = git('log -1 --format=%ct dev') ?? git('log -1 --format=%ct origin/dev');
  const releasePath = join(ROOT, 'qa', `release-${VERSION}.md`);
  const okRegex = /^(OK:|\*\*OK de Xaviel\*\*)/im;
  let okMarcado = false;
  if (existsSync(releasePath)) {
    try { okMarcado = okRegex.test(readFileSync(releasePath, 'utf8')); } catch { /* noop */ }
  }

  if (!ts) {
    if (okMarcado) return reportar('breathe', 'Dev tuvo tiempo de respirar / OK explícito', 'PASS', [`no se pudo leer la fecha del último commit de 'dev' (¿rama local ausente?), pero hay un OK explícito en ${releasePath}.`]);
    return reportar('breathe', 'Dev tuvo tiempo de respirar / OK explícito', 'FAIL', [
      `no se pudo determinar la fecha del último commit de 'dev' (ni local ni origin/dev) y no hay OK explícito en qa/release-${VERSION}.md.`,
      'Convención del OK: una línea que empiece con "OK:" o "**OK de Xaviel**" en ese archivo.',
    ]);
  }
  const horas = (Date.now() / 1000 - Number(ts)) / 3600;
  if (horas >= 24) return reportar('breathe', 'Dev tuvo tiempo de respirar / OK explícito', 'PASS', [`último commit de 'dev' hace ${horas.toFixed(1)}h (≥24h).`]);
  if (okMarcado) return reportar('breathe', 'Dev tuvo tiempo de respirar / OK explícito', 'PASS', [`último commit de 'dev' hace solo ${horas.toFixed(1)}h, pero hay OK explícito en qa/release-${VERSION}.md.`]);
  return reportar('breathe', 'Dev tuvo tiempo de respirar / OK explícito', 'FAIL', [
    `último commit de 'dev' hace solo ${horas.toFixed(1)}h (<24h) y no hay OK explícito.`,
    `Esperar, o agregar una línea "OK: <quién, qué probó, fecha>" en qa/release-${VERSION}.md.`,
  ]);
}

// ── Check 2 — migraciones de esta ventana en el ledger del entorno auditado ──
async function check2() {
  const { archivos, referencia } = archivosCambiadosDesde('sql');
  if (!archivos.length) {
    return reportar('ledger', `Migraciones sql/ en el ledger (${env.entorno})`, 'PASS', [`sin archivos sql/* tocados desde ${referencia}.`]);
  }
  const faltantes = [];
  const ok = [];
  for (const archivo of archivos) {
    const archivoNorm = archivo.replace(/\\/g, '/');
    let fila;
    try {
      const rows = await dbQuery(env, `select checksum from sgc.migraciones_aplicadas where archivo='${archivoNorm.replace(/'/g, "''")}' limit 1`);
      fila = Array.isArray(rows) ? rows[0] : null;
    } catch (e) {
      faltantes.push(`${archivoNorm} — no se pudo consultar el ledger: ${String(e.message).slice(0, 160)}`);
      continue;
    }
    if (!fila) { faltantes.push(`${archivoNorm} — no está en sgc.migraciones_aplicadas de ${env.entorno}`); continue; }
    const full = join(ROOT, archivoNorm);
    if (!existsSync(full)) { faltantes.push(`${archivoNorm} — está en el ledger pero el archivo ya no existe en el working tree`); continue; }
    const checksum = createHash('sha256').update(readFileSync(full, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
    if (fila.checksum !== checksum) { faltantes.push(`${archivoNorm} — en el ledger pero con OTRO contenido (checksum no coincide); reaplica con apply-migration.mjs --env ${env.entorno}`); continue; }
    ok.push(archivoNorm);
  }
  if (faltantes.length) {
    return reportar('ledger', `Migraciones sql/ en el ledger (${env.entorno})`, 'FAIL', [
      `${faltantes.length}/${archivos.length} archivo(s) sql/ (desde ${referencia}) NO están verificados en el ledger de ${env.entorno}:`,
      ...faltantes.map((f) => `- ${f}`),
    ]);
  }
  return reportar('ledger', `Migraciones sql/ en el ledger (${env.entorno})`, 'PASS', [`${ok.length} archivo(s) sql/ (desde ${referencia}) verificados en el ledger de ${env.entorno}.`]);
}

// ── Check 3 — registro humano de prueba (qa/release-<version>.md) ───────────
function check3() {
  const path = join(ROOT, 'qa', `release-${VERSION}.md`);
  if (!existsSync(path)) {
    return reportar('registro', 'Registro de prueba qa/release-<version>.md', 'FAIL', [
      `falta ${path}. Crea el archivo con algo como:`,
      '',
      '  # Release 1.191.0',
      '  - Equipo/tester: <nombre>',
      '  - Qué se probó: <flujo(s) ejercitados en dev.sgcconstructorasd.com>',
      '  - Versión de origen (si se prueba una actualización): <X.Y.Z anterior>',
      '  - Resultado: OK | FALLA (detalle)',
      '  - Fecha: <YYYY-MM-DD>',
      '',
      'Si Xaviel ya dio el visto bueno sin esperar 24h, agrega además una línea "OK: <detalle>" (ver check 1).',
    ]);
  }
  const contenido = readFileSync(path, 'utf8');
  const lineas = contenido.split('\n').map((l) => l.trim()).filter(Boolean);
  if (contenido.trim().length < 80 || lineas.length < 3) {
    return reportar('registro', 'Registro de prueba qa/release-<version>.md', 'FAIL', [`${path} existe pero parece un stub (${contenido.trim().length} caracteres, ${lineas.length} línea(s) no vacías) — completa el registro real de prueba.`]);
  }
  return reportar('registro', 'Registro de prueba qa/release-<version>.md', 'PASS', [`${path} (${lineas.length} líneas) presente.`]);
}

// ── Check 4 — evals de Compa, solo si la edge assistant cambió en la ventana ──
function check4() {
  const { archivos, referencia } = archivosCambiadosDesde('supabase/functions/assistant/index.ts');
  if (!archivos.length) {
    return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'SKIP', [`supabase/functions/assistant/index.ts sin cambios desde ${referencia}.`]);
  }
  const reportePath = join(ROOT, 'qa', `compa-evals-${env.entorno}.json`);
  if (!existsSync(reportePath)) {
    return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'FAIL', [
      `assistant/index.ts cambió (desde ${referencia}) pero falta ${reportePath}.`,
      `Corre: node scripts/compa-evals.mjs --env ${env.entorno}`,
    ]);
  }
  const edadHoras = (Date.now() - statSync(reportePath).mtimeMs) / 3600000;
  if (edadHoras > 24) {
    return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'FAIL', [
      `${reportePath} tiene ${edadHoras.toFixed(1)}h (>24h) — puede no reflejar el código actual.`,
      `Corre de nuevo: node scripts/compa-evals.mjs --env ${env.entorno}`,
    ]);
  }
  let data;
  try { data = JSON.parse(readFileSync(reportePath, 'utf8')); } catch (e) {
    return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'FAIL', [`${reportePath} no es JSON válido: ${String(e.message).slice(0, 160)}`]);
  }
  const resultadosEval = Array.isArray(data.resultados) ? data.resultados : [];
  if (!resultadosEval.length) {
    return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'FAIL', [`${reportePath} no tiene casos (resultados vacío).`]);
  }
  const fallidos = resultadosEval.filter((r) => !r.ok);
  if (fallidos.length) {
    return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'FAIL', [
      `${fallidos.length}/${resultadosEval.length} caso(s) de Compa fallando en ${reportePath}:`,
      ...fallidos.map((f) => `- ${f.id}: ${f.motivo ?? (f.fallos ?? []).join(' · ')}`),
    ]);
  }
  return reportar('compa-evals', 'Evals de Compa (si tocó assistant/index.ts)', 'PASS', [`${resultadosEval.length} caso(s) OK (reporte de hace ${edadHoras.toFixed(1)}h, assistant/index.ts cambió desde ${referencia}).`]);
}

// ── Check 5 — build + tests (último por ser el más lento) ───────────────────
function correr(cmd) {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1024 * 1024 * 50, timeout: 10 * 60 * 1000 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`.slice(-4000) };
  }
}
function check5() {
  if (SKIP_BUILD) {
    return reportar('build', 'Build + tests', 'SKIP', ['--skip-build: SOLO para debugging local de release-check.mjs — nunca uses este flag para un release real.']);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  console.log('\n   ⏳ npm run build (incluye prebuild: guards + evals de Compa de código + gen-version)…');
  const build = correr('npm run build');
  if (!build.ok) {
    return reportar('build', 'Build + tests', 'FAIL', ['`npm run build` falló:', ...build.out.split('\n').slice(-30)]);
  }

  const testCmd = pkg.scripts?.['test:unit'] ? 'npm run test:unit' : pkg.scripts?.test ? 'npm test' : null;
  if (!testCmd) {
    return reportar('build', 'Build + tests', 'PASS', ['`npm run build` OK.', 'sin script de tests en package.json — omitido.']);
  }
  console.log(`   ⏳ ${testCmd}…`);
  const test = correr(testCmd);
  if (!test.ok) {
    return reportar('build', 'Build + tests', 'FAIL', ['`npm run build` OK.', `\`${testCmd}\` falló:`, ...test.out.split('\n').slice(-30)]);
  }
  return reportar('build', 'Build + tests', 'PASS', ['`npm run build` OK.', `\`${testCmd}\` OK.`]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`▶ release-check — versión ${VERSION}, entorno auditado: ${env.entorno} (${env.ref})\n`);
console.log('docs/STAGING.md explica la disciplina detrás de este gate.');

check1();
await check2();
check3();
check4();
check5();

console.log('\n── Resumen ──');
for (const r of resultados) {
  const icono = r.estado === 'PASS' ? '✅' : r.estado === 'SKIP' ? '⏭ ' : '🔴';
  console.log(`  ${icono} ${r.estado.padEnd(4)} ${r.titulo}`);
}
const fallos = resultados.filter((r) => r.estado === 'FAIL');
if (fallos.length) {
  console.log(`\n🔴 ${fallos.length}/${resultados.length} check(s) en FAIL — NO promuevas dev → main hasta resolverlos.`);
  process.exit(1);
}
console.log(`\n✅ Todos los checks en PASS/SKIP (${resultados.length} total) — release-check OK para ${VERSION}.`);
