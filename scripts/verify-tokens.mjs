// verify-tokens.mjs — GUARDA DE DISEÑO (BD3). Corre en cada `prebuild`.
//
// Por qué existe: el rediseño BD3 centralizó el color en tokens semánticos
// (styles/_tokens.scss). La deuda que se limpió era el "fingerprint X-Dev": un hex
// oscuro (#161616 / #121212 / #1a1a1a / #212121 / #2d2d2d …) usado como valor de
// FONDO o BORDE dentro de un componente — copiado del vocabulario dark de otro
// proyecto y que en esta app CLARA sale como panel/borde oscuro sobre claro
// (bugs AS18/AX8/AZ2, la saga de "paneles oscuros"). Se arreglaron todos; este
// script impide que vuelvan: falla el build si reaparece el patrón.
//
// Regla: en cualquier `.scss` bajo `src/`, un `background|border*:` cuyo VALOR
// contenga uno de esos hex (y NO sea un fallback dentro de `var(--x, #hex)`) es un
// error. La tinta oscura sobre ámbar (`color:#121212` en un fill --accent) y el
// blanco sobre marca NO se tocan (no son fondo/borde oscuro). Mismo espíritu que
// verify-regresiones.mjs: rompe el deploy si algo prohibido reaparece.
//
// Escape-hatch legítimo (p. ej. un documento imprimible "papel"): añade el comentario
// `// tokens-allow-dark` al final de la línea y el guard la ignora.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');

// Hex oscuros del vocabulario X-Dev (near-black). Solo estos: no perseguimos
// grises legítimos ni la tinta de documentos.
const DARK_HEX = /#(161616|121212|1a1a1a|1e1e1e|212121|2d2d2d|0f0f0f|181818|222222|262626)\b/i;
// Declaración de SUPERFICIE/BORDE (donde un oscuro = el bug). Captura el VALOR.
// `color` queda fuera a propósito (tinta oscura sobre ámbar/marca es correcta).
// No anclado a inicio de línea: atrapa también `.x { background: #161616 }`.
// `border(-…)?` no matchea `border-radius` (radius no está en la alternancia).
const SURFACE_DECL =
  /\b(background(?:-color)?|border(?:-(?:top|bottom|left|right|color))?)\s*:\s*([^;{}]+)/gi;
const ALLOW = /tokens-allow-dark/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.scss')) out.push(p);
  }
  return out;
}

// ¿el valor tiene un oscuro REAL (no solo dentro de un fallback `var(--x, #hex)`)?
// Quitamos los var(...) (y sus fallbacks, código muerto) antes de mirar.
function valueHasRealDark(value) {
  return DARK_HEX.test(value.replace(/var\([^)]*\)/g, ''));
}

const violations = [];
// CB v2 — texto blanco sobre naranja. `--accent` (naranja) SIEMPRE lleva tinta
// navy `--text-on-accent` (AA). Blanco sobre naranja = 2.8:1, falla. Detectamos
// un bloque que ponga `background: var(--accent)` y a la vez `color:` blanco.
// Solo el naranja como valor PRIMARIO (no como fallback `var(--x, var(--accent))`
// ni el naranja suave/soft, que lleva tinta oscura).
const ACCENT_BG = /\bbackground(?:-color|-image)?\s*:\s*var\(\s*--accent(?:-hover)?\s*\)/i;
const WHITE_COLOR = /\bcolor\s*:\s*(#fff(?:fff)?\b|white\b|var\(--white\)|var\(--text-on-brand\))/i;
const accentWarnings = [];

// Rango del bloque `{ … }` que contiene la línea idx (heurística por llaves).
function blockRange(lines, idx) {
  let start = idx;
  for (let i = idx; i >= 0 && i > idx - 60; i--) {
    if (lines[i].includes('{')) { start = i; break; }
  }
  let end = idx, depth = 0;
  for (let i = start; i < lines.length && i < start + 120; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; return [start, end]; } }
    }
  }
  return [start, end];
}

for (const file of walk(SRC_DIR)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    // (A) fondo/borde oscuro heredado (fingerprint X-Dev)
    if (DARK_HEX.test(line)) {
      for (const m of line.matchAll(SURFACE_DECL)) {
        if (valueHasRealDark(m[2])) {
          violations.push({
            file: relative(join(__dirname, '..'), file),
            line: i + 1,
            text: `${m[1]}: ${m[2].trim()}`,
          });
          break;
        }
      }
    }
    // (B) blanco sobre naranja
    if (ACCENT_BG.test(line)) {
      const [s, e] = blockRange(lines, i);
      for (let j = s; j <= e; j++) {
        if (ALLOW.test(lines[j])) continue;
        if (WHITE_COLOR.test(lines[j])) {
          accentWarnings.push({
            file: relative(join(__dirname, '..'), file),
            line: j + 1,
            text: lines[j].trim().slice(0, 80),
          });
          break;
        }
      }
    }
  });
}

let failed = false;
if (violations.length) {
  failed = true;
  console.error(
    `\n[verify-tokens] ✗ ${violations.length} fondo/borde oscuro heredado (fingerprint X-Dev) — ` +
      `usa un token semántico (var(--surface|--surface-2|--border)) en vez del hex oscuro.\n` +
      `Si de verdad debe ser oscuro (documento "papel"), añade "// tokens-allow-dark" a la línea.\n`,
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('');
}

if (accentWarnings.length) {
  failed = true;
  console.error(
    `\n[verify-tokens] ✗ ${accentWarnings.length} texto BLANCO sobre naranja (--accent) — ` +
      `falla AA (2.8:1). Usa \`color: var(--text-on-accent)\` (tinta navy).\n` +
      `Si es un caso legítimo, añade "// tokens-allow-dark" a la línea.\n`,
  );
  for (const v of accentWarnings) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('');
}

if (failed) process.exit(1);

console.log('[verify-tokens] ✓ sin fondos/bordes oscuros heredados ni blanco sobre naranja.');
