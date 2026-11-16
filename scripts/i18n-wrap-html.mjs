/**
 * DP-08 (CONTEXTO-72) — Codemod que envuelve texto visible de plantillas HTML
 * con el pipe `t` (`{{ 'texto' | t }}` / `placeholder="{{ 'texto' | t }}"`).
 *
 * Dry-run por defecto (solo reporta). `--write` aplica los cambios.
 * `--modulo <carpeta>` acota a `src/app/pages/<carpeta>` (por lote, ver
 * docs/I18N-AVANCE.md). Sin `--modulo`, recorre TODO `src/app/pages`.
 *
 * Qué transforma (seguro, sin interpretar el DOM — basado en línea):
 *   - Nodos de texto `>texto plano<` SIN `{{` existente dentro.
 *   - Atributos visibles (placeholder/title/aria-label/alt/mat-label) con
 *     valor literal plano (sin `{{` dentro).
 *
 * Qué deja para revisión manual (se reporta, NUNCA se adivina):
 *   - Líneas con interpolación mixta (`{{ expr }}` ya presente junto a texto).
 *   - Entidades HTML (&nbsp; &amp; …) dentro del texto.
 *   - Líneas dentro de <option>, <pre>, <code> (heurística: la etiqueta
 *     aparece en la misma línea).
 *   - Texto ya cubierto (`| t`, `t('...')`, `i18n.t(`).
 *
 * Tras escribir, agrega `TranslatePipe` al array `imports` del componente si
 * el `.html` lo necesita y el `.ts` aún no lo tiene.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';

const ROOT = process.cwd();
const PAGES = join(ROOT, 'src', 'app', 'pages');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const moduloIdx = args.indexOf('--modulo');
const MODULO = moduloIdx >= 0 ? args[moduloIdx + 1] : null;

let WHITELIST = [];
try {
  WHITELIST = JSON.parse(readFileSync(join(ROOT, 'scripts', 'i18n-whitelist.json'), 'utf8'));
} catch { /* opcional */ }
const WHITE = new Set(WHITELIST.map((s) => s.toLowerCase()));

const HAS_LETTER = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
const ATTRS_VISIBLES = ['placeholder', 'title', 'aria-label', 'alt', 'mat-label'];

function esRuido(s) {
  const t = s.trim();
  if (!t) return true;
  if (!HAS_LETTER.test(t)) return true;
  if (t.length < 2) return true;
  if (WHITE.has(t.toLowerCase())) return true;
  if (/^(true|false|null|px|em|rem)$/i.test(t)) return true;
  if (/^[a-z][A-Za-z0-9]*\([^)]*\)$/.test(t)) return true;
  return false;
}

function yaCubierto(line) {
  return /\|\s*t\b/.test(line) || /\bt\(\s*['"]/.test(line) || /i18n\.t\(/.test(line);
}

function escaparComillaSimple(s) {
  return s.replace(/'/g, "\\'");
}

function walkHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

const base = MODULO ? join(PAGES, MODULO) : PAGES;
if (!existsSync(base)) {
  console.error(`✗ no existe: ${base}`);
  process.exit(1);
}
const files = walkHtml(base);

let totalEnvueltos = 0;
let totalSaltados = 0;
const saltadosPorArchivo = new Map();
const archivosTocados = [];

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const lines = original.split(/\r?\n/);
  let cambiado = false;
  let envueltosArchivo = 0;
  let saltadosArchivo = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Saltar por completo líneas de <option>/<pre>/<code> (heurística por línea).
    if (/<(option|pre|code)\b/i.test(line)) continue;
    // Entidades HTML → manual.
    if (/&[a-zA-Z#0-9]+;/.test(line)) {
      saltadosArchivo++;
      continue;
    }
    // Un binding `[attr]="...<..."` o `[attr]="...>..."` (comparaciones TS,
    // p. ej. `[class.cn-up]="a > b"`) tiene un '<'/'>' DENTRO de un atributo,
    // no delimitando una etiqueta — el regex de nodos de texto de abajo no
    // distingue eso de un cierre/apertura real y corrompe la línea (visto en
    // conteos.html: partió un atributo a la mitad). Se salta toda la línea.
    if (/\]="[^"]*[<>][^"]*"/.test(line)) {
      saltadosArchivo++;
      continue;
    }

    // 1) Atributos visibles con literal plano (sin `{{` en el valor).
    for (const attr of ATTRS_VISIBLES) {
      const re = new RegExp(`\\b(${attr})="([^"{}]*)"`, 'g');
      line = line.replace(re, (m, nombre, valor) => {
        if (esRuido(valor)) return m;
        envueltosArchivo++;
        cambiado = true;
        return `${nombre}="{{ '${escaparComillaSimple(valor.trim())}' | t }}"`;
      });
    }

    // 2) Nodos de texto `>texto<` sin `{{` ya presente en ese segmento.
    line = line.replace(/>([^<>{}]+)</g, (m, texto) => {
      if (esRuido(texto)) return m;
      const trimmed = texto.trim();
      const lead = texto.slice(0, texto.indexOf(trimmed));
      const trail = texto.slice(texto.indexOf(trimmed) + trimmed.length);
      envueltosArchivo++;
      cambiado = true;
      return `>${lead}{{ '${escaparComillaSimple(trimmed)}' | t }}${trail}<`;
    });

    // 3) Lo que queda con `{{` Y texto plano alrededor (mixto) → manual.
    if (/\{\{[^}]*\}\}/.test(line) && !yaCubierto(line)) {
      const sinInterp = line.replace(/\{\{[\s\S]*?\}\}/g, ' ');
      const nodos = [...sinInterp.matchAll(/>([^<>]+)</g)].map((m) => m[1]);
      if (nodos.some((n) => !esRuido(n))) saltadosArchivo++;
    }

    lines[i] = line;
  }

  if (saltadosArchivo) saltadosPorArchivo.set(relative(ROOT, file).split('\\').join('/'), saltadosArchivo);
  totalSaltados += saltadosArchivo;
  totalEnvueltos += envueltosArchivo;

  if (cambiado) {
    archivosTocados.push({ file, envueltos: envueltosArchivo });
    if (WRITE) {
      writeFileSync(file, lines.join('\n'));
      asegurarTranslatePipe(file);
    }
  }
}

// Agrega `TranslatePipe` a `imports: [...]` del componente si el .html usa `| t`
// y el .ts todavía no lo importa.
function asegurarTranslatePipe(htmlFile) {
  const dir = dirname(htmlFile);
  const name = basename(htmlFile, '.html');
  const tsFile = join(dir, `${name}.ts`);
  if (!existsSync(tsFile)) return;
  let ts = readFileSync(tsFile, 'utf8');
  if (/TranslatePipe/.test(ts)) return; // ya lo tiene

  // Ruta relativa desde el componente hasta shared/i18n/translate.pipe.
  const rel = relative(dir, join(ROOT, 'src', 'shared', 'i18n', 'translate.pipe'))
    .split('\\').join('/');
  const importPath = rel.startsWith('.') ? rel : `./${rel}`;

  // 1) agrega el import (tras el último import existente).
  // DP-20 — un import puede ser multilínea (`import {\n  A, B,\n} from '...'`);
  // buscar la última línea que EMPIEZA con "import" (como antes) partía el
  // bloque a la mitad si esa línea era solo la apertura `import {` de un
  // import multilínea. Ahora se busca el cierre real de cada statement
  // (`... from '...';`), multilínea incluido, y se inserta tras el último.
  const importStmtRe = /^import\s[\s\S]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm;
  let lastEnd = -1;
  let m;
  while ((m = importStmtRe.exec(ts)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) return; // archivo sin imports con "from", no tocar (raro)
  ts = `${ts.slice(0, lastEnd)}\nimport { TranslatePipe } from '${importPath}';${ts.slice(lastEnd)}`;

  // 2) agrega TranslatePipe al array `imports: [...]` del @Component.
  const impMatch = ts.match(/imports:\s*\[([^\]]*)\]/);
  if (impMatch) {
    const contenido = impMatch[1];
    const nuevo = contenido.trim().length
      ? `${contenido.replace(/\s+$/, '')}, TranslatePipe`
      : 'TranslatePipe';
    ts = ts.replace(/imports:\s*\[([^\]]*)\]/, `imports: [${nuevo}]`);
  } else {
    // DP-20 — el @Component no tenía ningún array `imports: [...]` (standalone
    // sin dependencias hasta ahora). Insertarlo justo tras `selector: '...'`.
    const selMatch = ts.match(/selector:\s*'[^']*',?/);
    if (selMatch) {
      const pos = selMatch.index + selMatch[0].length;
      ts = `${ts.slice(0, pos)}\n  imports: [TranslatePipe],${ts.slice(pos)}`;
    } else {
      console.warn(`  ⚠ ${relative(ROOT, tsFile)}: no se encontró "selector:" ni "imports: [...]" — agregar TranslatePipe a mano.`);
    }
  }
  writeFileSync(tsFile, ts);
}

console.log(`[i18n-wrap-html] ${WRITE ? 'ESCRITO' : 'dry-run'} · módulo: ${MODULO || 'TODOS'} · ${files.length} archivo(s) analizados`);
console.log(`  envueltos: ${totalEnvueltos} · saltados (revisión manual): ${totalSaltados}`);
if (archivosTocados.length) {
  console.log(`  archivos con cambios (${archivosTocados.length}):`);
  for (const a of archivosTocados.sort((x, y) => y.envueltos - x.envueltos)) {
    console.log(`    ${relative(ROOT, a.file).split('\\').join('/')}: ${a.envueltos}`);
  }
}
if (saltadosPorArchivo.size) {
  console.log(`  saltados por archivo (mixto/entidades — revisar a mano):`);
  for (const [f, n] of saltadosPorArchivo) console.log(`    ${f}: ${n}`);
}
if (!WRITE) console.log('  (dry-run: nada escrito. Repetir con --write para aplicar.)');
