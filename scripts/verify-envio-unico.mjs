// scripts/verify-envio-unico.mjs — CO16 (PROMPT-98 F1.3), prebuild.
//
// Por qué existe: la causa real de CO3 (echada ×5) y CO5 (conduce ×3) es que el
// método de envío revisaba la bandera `busy` en la primera línea pero no la ponía
// en `true` hasta DESPUÉS de un `await` (GPS, posible-duplicado, confirmación…).
// Cada toque mientras ese await está en vuelo pasa la barrera. El servidor ya
// tiene una red de 120s (sql/2026-10-14-co15-co3-co5-combustible-conduce-antidup.sql)
// pero el arreglo de raíz es del cliente: la bandera va en la PRIMERA línea.
//
// Qué chequea: en cada método `submit*/onSave/guardar*/crear*/enviar*/confirmar*`
// de `src/app/pages/**`, si el cuerpo pone una bandera de ocupado (`saving`,
// `submitting`, `busy`, `guardando`, `enviando` vía signal `.set(true)` o
// asignación directa `= true`), esa puesta en true debe ocurrir ANTES del primer
// `await` del método. Si hay `await` antes → FALLA.
//
// Escaneo ESTÁTICO por texto (balanceo de llaves), no AST → heurística, no
// compilador. Puede tener falsos positivos en casos raros (comentarios con
// "await" literal); revisar manualmente si se dispara uno dudoso.
//
//   node scripts/verify-envio-unico.mjs [--report]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PAGES_DIR = join(ROOT, 'src', 'app', 'pages');
const REPORT_ONLY = process.argv.includes('--report');

const METHOD_NAME_RE = /\b(submit|onSave|guardar|crear|enviar|confirmar)\w*\s*\(/i;
const FLAG_SET_RE = /\b(saving|submitting|busy|guardando|enviando)\w*\s*\.set\(\s*true\s*\)|\bthis\.\w*(saving|submitting|busy|guardando|enviando)\w*\s*=\s*true\b/i;
const AWAIT_RE = /\bawait\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

// Dado el índice de '(' que abre los parámetros de un método, encuentra el
// cuerpo `{ … }` que sigue (saltando el tipo de retorno) y devuelve su rango.
function extraerCuerpo(text, parenOpenIdx) {
  let i = parenOpenIdx, depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  // desde aquí hasta el primer '{' (puede haber ": Promise<...>" en medio)
  const braceStart = text.indexOf('{', i);
  if (braceStart === -1) return null;
  let d = 0, j = braceStart;
  for (; j < text.length; j++) {
    if (text[j] === '{') d++;
    else if (text[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return { start: braceStart, end: j };
}

// Quita comentarios `//…` y `/*…*/` (sin tocar la longitud: los rellena con
// espacios) para que una palabra "await"/"saving" dentro de un comentario no
// dispare un falso positivo en el orden texto de las coincidencias reales.
function sinComentarios(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

function revisarArchivo(path) {
  const textoOriginal = readFileSync(path, 'utf8');
  const text = sinComentarios(textoOriginal);
  const hallazgos = [];
  const re = new RegExp(METHOD_NAME_RE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const parenOpenIdx = text.indexOf('(', m.index);
    const cuerpo = extraerCuerpo(text, parenOpenIdx);
    if (!cuerpo) continue;
    const body = text.slice(cuerpo.start, cuerpo.end);
    const flagMatch = body.match(FLAG_SET_RE);
    const awaitMatch = body.match(AWAIT_RE);
    if (flagMatch && awaitMatch && body.indexOf(awaitMatch[0]) < body.indexOf(flagMatch[0])) {
      const linea = text.slice(0, cuerpo.start).split('\n').length;
      hallazgos.push({ metodo: m[0].replace(/\($/, ''), linea });
    }
    re.lastIndex = cuerpo.end; // no reescanear el mismo cuerpo con métodos anidados
  }
  return hallazgos;
}

const archivos = walk(PAGES_DIR);
const problemas = [];
for (const f of archivos) {
  const hallazgos = revisarArchivo(f);
  for (const h of hallazgos) problemas.push({ archivo: relative(ROOT, f), ...h });
}

if (!problemas.length) {
  console.log('✅ verify-envio-unico: ningún método de envío tiene `await` antes de la bandera de ocupado.');
  process.exit(0);
}

console.log(`🔴 verify-envio-unico: ${problemas.length} método(s) con \`await\` ANTES de poner la bandera (doble-toque posible):\n`);
for (const p of problemas) console.log(`  ${p.archivo}:${p.linea}  ${p.metodo}(…)`);
console.log('\nMueve `algo.set(true)` (o `this.algo = true`) a la primera línea del método, antes de cualquier `await`.');
if (REPORT_ONLY) process.exit(0);
process.exit(1);
