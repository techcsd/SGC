/**
 * BT2 (regla 17) — Inventario de cobertura i18n POR PANTALLA.
 *
 * Por qué existe: la convención "clave = texto en español" hace que TODO lo no
 * cableado con `t()` se vea "bien" en español y nadie lo note en build. Un cambio de
 * idioma que deja media pantalla en español es un bug, no un "rollout incremental".
 * La unidad de cobertura es la PANTALLA, no la clave.
 *
 * Qué hace: recorre `src/app (todos los .html)`, extrae el texto VISIBLE (nodos de texto,
 * `placeholder`, `aria-label`, `title`, `mat-label`, labels de botón), ignora
 * interpolaciones puras, números y nombres propios (whitelist), y reporta por
 * PANTALLA (carpeta bajo `pages/`) cuántos literales pasan por `| t` y cuántos no.
 *
 * Salidas:
 *   · docs/I18N-COVERAGE.md      (tabla legible)
 *   · docs/i18n-coverage.json    (datos)
 *   · src/shared/i18n/i18n-coverage.generated.ts  (%, para el selector honesto)
 *
 * Guard (usado por verify-i18n): una pantalla marcada `enforce:true` en
 * `src/app/core/i18n/alcance.json` NO puede tener literales sin `t()`.
 *
 * Compartible con la app (csd-app): sin dependencias de Angular.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const PAGES = join(SRC, 'app', 'pages');

// Nombres propios / marcas que NO se traducen aunque aparezcan como texto.
let WHITELIST = [];
try {
  WHITELIST = JSON.parse(readFileSync(join(ROOT, 'scripts', 'i18n-whitelist.json'), 'utf8'));
} catch { /* opcional */ }
const WHITE = new Set(WHITELIST.map((s) => s.toLowerCase()));

// ── Extracción de literales visibles de un template ─────────────────────────
// Heurística: un "literal visible" es texto con al menos una letra (incluye
// acentos/ñ). Se considera CUBIERTO si su línea/segmento lo pasa por `| t` o
// `i18n.t('…')`. Ignoramos: interpolaciones puras `{{ expr }}` sin string literal,
// atributos técnicos, números, símbolos, y nombres propios de la whitelist.

const HAS_LETTER = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
const ATTR_VISIBLE = /\b(placeholder|aria-label|title|mat-label|alt)\s*=\s*"([^"]*)"/g;
const TEXT_ATTR_BOUND = /\[(placeholder|title|attr\.aria-label|attr\.title)\]\s*=\s*"([^"]*)"/g;

function esCubierto(seg) {
  // El segmento pasa por el pipe t o por i18n.t('…')
  return /\|\s*t\b/.test(seg) || /\bt\(\s*['"]/.test(seg) || /i18n\.t\(/.test(seg);
}

function limpiar(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function esRuido(s) {
  const t = s.trim();
  if (!t) return true;
  if (!HAS_LETTER.test(t)) return true;               // números, símbolos
  if (t.length < 2) return true;
  if (WHITE.has(t.toLowerCase())) return true;         // nombre propio
  // Palabras técnicas de binding que a veces quedan sueltas.
  if (/^(true|false|null|ngIf|ngFor|px|em|rem)$/i.test(t)) return true;
  // Un token que es claramente una expresión (camelCase con paréntesis) no es copy.
  if (/^[a-z][A-Za-z0-9]*\([^)]*\)$/.test(t)) return true;
  return false;
}

// Quita interpolaciones que NO llevan string literal (solo expresión): esas no son copy.
// Deja las que llevan `'texto' | t` para poder contarlas como cubiertas.
function stripExprInterpolations(html) {
  return html.replace(/\{\{([\s\S]*?)\}\}/g, (m, inner) => {
    if (/['"]/.test(inner)) return m; // tiene literal → conservar
    return ' '; // pura expresión → no es copy visible
  });
}

// Extrae segmentos de texto entre tags (nodos de texto) y de atributos visibles.
function extraerLiterales(htmlOriginal) {
  const html = stripExprInterpolations(htmlOriginal);
  const items = []; // { texto, cubierto }

  // 1) Nodos de texto entre '>' y '<'
  const NODE_RE = />([^<>]+)</g;
  const COV_RE = /\{\{\s*(['"])((?:\\.|(?!\1).)*?)\1\s*\|\s*t\b[\s\S]*?\}\}/g;
  let m;
  while ((m = NODE_RE.exec(html))) {
    const raw = m[1];
    // 1a) CUBIERTOS: interpolaciones con un literal pasado por `| t`.
    COV_RE.lastIndex = 0;
    let c;
    while ((c = COV_RE.exec(raw))) {
      const lit = limpiar(c[2].replace(/\\(['"])/g, '$1'));
      if (!esRuido(lit)) items.push({ texto: lit, cubierto: true });
    }
    // 1b) SIN CUBRIR: el texto plano que queda al quitar TODAS las interpolaciones.
    const plano = limpiar(raw.replace(/\{\{[\s\S]*?\}\}/g, ' '));
    if (!esRuido(plano)) items.push({ texto: plano, cubierto: false });
  }

  // 2) Atributos visibles con string literal directo
  for (const re of [ATTR_VISIBLE]) {
    re.lastIndex = 0;
    while ((m = re.exec(html))) {
      const val = limpiar(m[2]);
      if (esRuido(val)) continue;
      if (/\{\{/.test(m[2])) continue; // interpolado, ya contado arriba
      items.push({ texto: val, cubierto: false });
    }
  }
  // 3) Atributos ligados `[placeholder]="'texto' | t"` → cubiertos
  for (const re of [TEXT_ATTR_BOUND]) {
    re.lastIndex = 0;
    while ((m = re.exec(html))) {
      const val = m[2];
      if (!/['"]/.test(val)) continue; // expresión, no copy
      const lit = limpiar((val.match(/['"]([^'"]+)['"]/) || [, ''])[1]);
      if (esRuido(lit)) continue;
      items.push({ texto: lit, cubierto: esCubierto(val) });
    }
  }
  return items;
}

// ── Recorrido por pantalla ──────────────────────────────────────────────────
function walkHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

// "Pantalla" = primera carpeta bajo pages/ (p. ej. pages/flota/... → flota;
// pages/inventario/requisiciones/... → inventario/requisiciones para granularidad).
function pantallaDe(file) {
  const rel = relative(PAGES, file);
  const parts = rel.split(sep);
  // Dos niveles de granularidad como máximo (módulo/subpantalla).
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/') || parts[0];
}

const files = existsSync(PAGES) ? walkHtml(PAGES) : [];
const porPantalla = new Map(); // pantalla → { total, cubiertos, sin: [] }

for (const f of files) {
  const pant = pantallaDe(f);
  const items = extraerLiterales(readFileSync(f, 'utf8'));
  if (!porPantalla.has(pant)) porPantalla.set(pant, { total: 0, cubiertos: 0, sin: [] });
  const acc = porPantalla.get(pant);
  for (const it of items) {
    acc.total++;
    if (it.cubierto) acc.cubiertos++;
    else acc.sin.push(it.texto);
  }
}

// ── Alcance ─────────────────────────────────────────────────────────────────
let ALCANCE = { pantallas: {} };
try {
  ALCANCE = JSON.parse(readFileSync(join(SRC, 'app', 'core', 'i18n', 'alcance.json'), 'utf8'));
} catch { /* opcional */ }

// ── Resumen + salidas ───────────────────────────────────────────────────────
const filas = [...porPantalla.entries()]
  .map(([pantalla, a]) => ({
    pantalla,
    total: a.total,
    cubiertos: a.cubiertos,
    sin: a.total - a.cubiertos,
    pct: a.total ? Math.round((a.cubiertos / a.total) * 100) : 100,
    enScope: !!ALCANCE.pantallas?.[pantalla],
    enforce: !!ALCANCE.pantallas?.[pantalla]?.enforce,
    faltantes: a.sin,
  }))
  .sort((x, y) => (y.enScope - x.enScope) || x.pct - y.pct);

// Cobertura global del ALCANCE (para el selector honesto).
const enScope = filas.filter((f) => f.enScope);
const totScope = enScope.reduce((s, f) => s + f.total, 0);
const cubScope = enScope.reduce((s, f) => s + f.cubiertos, 0);
const pctScopeEn = totScope ? Math.round((cubScope / totScope) * 100) : 0;
// ht: sin catálogo → 0 hasta que se traduzca (medido aparte cuando exista ht.json con claves).
let pctHt = 0;
try {
  const ht = JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'ht.json'), 'utf8'));
  const en = JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'en.json'), 'utf8'));
  const enKeys = Object.keys(en).length || 1;
  pctHt = Math.round((Object.keys(ht).length / enKeys) * 100);
} catch { /* ht vacío */ }

// Markdown
const md = [];
md.push('# Cobertura i18n por pantalla (BT2, regla 17)');
md.push('');
md.push(`> Generado por \`scripts/i18n-coverage.mjs\`. La unidad es la **pantalla**. El selector`);
md.push(`> ofrece \`en\` cuando el alcance ≥95 % y \`ht\` cuando ≥90 % (si no: *beta*/*próximamente*).`);
md.push('');
md.push(`**Alcance \`en\`: ${pctScopeEn}%** (${cubScope}/${totScope} literales de ${enScope.length} pantallas en alcance). **\`ht\`: ${pctHt}%**.`);
md.push('');
md.push('| Pantalla | Alcance | Total | con t() | sin t() | % |');
md.push('|---|:---:|---:|---:|---:|---:|');
for (const f of filas) {
  const marca = f.enScope ? (f.enforce ? 'enforce' : 'scope') : '-';
  md.push(`| ${f.pantalla} | ${marca} | ${f.total} | ${f.cubiertos} | ${f.sin} | ${f.pct}% |`);
}
writeFileSync(join(ROOT, 'docs', 'I18N-COVERAGE.md'), md.join('\n') + '\n');
writeFileSync(join(ROOT, 'docs', 'i18n-coverage.json'), JSON.stringify({ pctScopeEn, pctHt, filas }, null, 2));

// Constante para el selector honesto (umbrales 95/90).
const gen =
  `// Generado por scripts/i18n-coverage.mjs — NO editar a mano (BT2, regla 17).\n` +
  `export const I18N_COVERAGE = { en: ${pctScopeEn}, ht: ${pctHt} } as const;\n` +
  `export const I18N_UMBRAL = { en: 95, ht: 90 } as const;\n`;
writeFileSync(join(SRC, 'shared', 'i18n', 'i18n-coverage.generated.ts'), gen);

// ── Guard: pantallas enforce sin t() rompen (lo invoca verify-i18n) ─────────
const rotas = filas.filter((f) => f.enforce && f.sin > 0);
console.log(`[i18n-coverage] alcance en=${pctScopeEn}% ht=${pctHt}% · ${enScope.length} pantallas en alcance · ${filas.length} totales.`);
if (rotas.length) {
  console.error(`\x1b[31m✗ i18n-coverage: ${rotas.length} pantalla(s) 'enforce' con literales sin t():\x1b[0m`);
  for (const r of rotas) {
    console.error(`  ${r.pantalla} (${r.sin} sin t()): ${r.faltantes.slice(0, 6).join(' · ')}${r.faltantes.length > 6 ? ' …' : ''}`);
  }
  process.exit(1);
}
console.log('[i18n-coverage] ✓ ninguna pantalla enforce con literales sin t().');
