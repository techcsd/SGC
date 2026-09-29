// verify-contraste.mjs — CB v2 / FASE 7. Comprueba el contraste WCAG AA de los
// pares de tokens (texto/superficie, estado/fondo, acento/tinta) en AMBOS temas.
// Lee los valores reales de src/styles/_tokens.scss, resuelve las cadenas var()
// hasta el hex primitivo y compone los rgba() sobre su superficie. Imprime una
// tabla y sale con código ≠0 si un par de TEXTO cae por debajo de su umbral.
//
// Umbrales: texto normal 4.5:1 · texto grande / UI / estado-sobre-fondo 3.0:1.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(__dirname, '..', 'src', 'styles', '_tokens.scss');
const css = readFileSync(TOKENS, 'utf8');

// ── Parse: mapas de --var → valor para light (:root) y dark ([data-theme='dark']) ──
function parseBlock(re) {
  const m = css.match(re);
  const map = {};
  if (!m) return map;
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map[d[1]] = d[2].trim();
  return map;
}
// Todos los :root { } (primitivos + semánticos light) se funden.
const light = {};
for (const b of css.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)) {
  for (const d of b[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) light[d[1]] = d[2].trim();
}
const dark = { ...light, ...parseBlock(/\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\n\}/) };

// ── Resolver var()/hex/rgb(a) → {r,g,b,a} ───────────────────────────────────────
function toRgb(value, map, depth = 0) {
  if (!value || depth > 12) return null;
  value = value.trim();
  let m = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (m) return toRgb(map[m[1]] ?? m[2], map, depth + 1);
  m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = value.match(/^#([0-9a-f]{3})$/i);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
// Compone fg (posible alpha) sobre bg opaco.
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}
function lum({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const L1 = lum(fg), L2 = lum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// [fg, bg, umbral, etiqueta]. bg también sirve para componer un fg con alpha.
const PARES = [
  ['--text', '--surface', 4.5, 'texto sobre tarjeta'],
  ['--text', '--bg', 4.5, 'texto sobre lienzo'],
  ['--text-2', '--surface', 4.5, 'texto secundario'],
  ['--text-3', '--surface', 3.0, 'muted/placeholder (UI 3:1)'],
  ['--text-on-accent', '--accent', 4.5, 'tinta sobre naranja'],
  ['--text-on-brand', '--brand', 4.5, 'texto sobre navy (botón)'],
  ['--brand', '--surface', 3.0, 'marca como texto/enlace'],
  // El naranja de acción (--accent) es para RELLENOS (con tinta navy --text-on-accent).
  // Como TEXTO sobre claro se usa el más oscuro --accent-hover (el claro falla AA).
  ['--accent-hover', '--surface', 3.0, 'acento como texto (usar accent-hover)'],
  ['--success', '--success-bg', 3.0, 'éxito sobre su fondo'],
  ['--warning', '--warning-bg', 3.0, 'aviso sobre su fondo'],
  ['--danger', '--danger-bg', 3.0, 'peligro sobre su fondo'],
  ['--info', '--info-bg', 3.0, 'info sobre su fondo'],
  ['--nav-text', '--nav-bg', 4.5, 'texto del sidebar'],
  ['--nav-text-muted', '--nav-bg', 3.0, 'sidebar muted (UI)'],
];

let failed = 0;
for (const theme of ['light', 'dark']) {
  const map = theme === 'light' ? light : dark;
  console.log(`\n  ${theme.toUpperCase()}`);
  console.log('  ' + '─'.repeat(64));
  for (const [fgT, bgT, thr, label] of PARES) {
    const bg0 = toRgb(map[bgT], map);
    // el fondo de estado puede ser rgba → componer sobre --surface del tema
    const surface = toRgb(map['--surface'], map);
    const bg = bg0 ? over(bg0, surface) : surface;
    const fg = over(toRgb(map[fgT], map) ?? { r: 0, g: 0, b: 0, a: 1 }, bg);
    const r = ratio(fg, bg);
    const ok = r >= thr;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${r.toFixed(2).padStart(5)}:1  (min ${thr})  ${fgT} / ${bgT}  — ${label}`);
  }
}

console.log('');
if (failed) { console.error(`[verify-contraste] ✗ ${failed} par(es) por debajo del umbral AA.\n`); process.exit(1); }
console.log('[verify-contraste] ✓ todos los pares cumplen AA en ambos temas.\n');
