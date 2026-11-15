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
  // Bloques de control flow de Angular (@if/@for/@else/@switch/…) que el
  // regex de nodos de texto atrapa como "texto" entre un '>' y un '<' porque
  // no están envueltos en una etiqueta — no son copy, son sintaxis de plantilla.
  // Tolera un separador decorativo (p. ej. "·") pegado justo antes del @if
  // cuando ambos quedan en el mismo nodo de texto (sin tag de por medio).
  if (/^[}\s(·]*@(if|else if|else|for|switch|case|default|empty)\b/.test(t)) return true;
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
  // Los comentarios <!-- ... --> tienen su propio '<' y '>' que confunden al
  // regex de nodos de texto (el '>' de cierre de un tag anterior + el '<' de
  // "<!--" delimitan un falso "nodo" que es en realidad el comentario) —
  // se reemplazan por espacios ANTES de stripExprInterpolations.
  const sinComentarios = htmlOriginal.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  // Un binding `[attr]="...<..."` / `[attr]="...>..."` (comparaciones TS, p.
  // ej. `[class.ar-up]="a > b"`) tiene un '<'/'>' DENTRO de un atributo, no
  // delimitando una etiqueta real — confunde al regex de nodos de abajo
  // igual que un comentario. Se neutraliza (mismo largo, para no desalinear
  // columnas/posiciones) antes de escanear.
  const sinBindingsComparacion = sinComentarios.replace(/\]="[^"]*[<>][^"]*"/g, (m) => ' '.repeat(m.length));
  // Mismo problema que arriba pero en la CONDICIÓN de un @if/@else if de
  // control flow (no en un atributo): `@if (a > b) { ... }` tiene un '>' que
  // no delimita ninguna etiqueta. Se neutraliza igual, solo dentro del `(...)`.
  const sinCondicionesComparacion = sinBindingsComparacion.replace(
    /@(?:if|else if)\s*\([^()]*[<>][^()]*\)/g,
    (m) => ' '.repeat(m.length),
  );
  const html = stripExprInterpolations(sinCondicionesComparacion);
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

// ── DP-07c — literales dentro de `.ts` (toasts/confirm/alert/labels/placeholders
// que NO pasan por el escáner de HTML porque no viven en un template). Mismo
// criterio: cubierto = ya pasa por `t()`/`i18n.t()`; sin cubrir = literal crudo.
const TS_LLAMADA_LITERAL_RE = /\b(?:this\.)?(?:toast|snackbar)\.(?:error|success|warning|info|errorFrom)\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const TS_LLAMADA_T_RE = /\b(?:this\.)?(?:toast|snackbar)\.(?:error|success|warning|info|errorFrom)\(\s*(?:this\.)?(?:i18n\.)?t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const TS_CONFIRM_RE = /\b(?:window\.)?(?:confirm|alert)\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
// (?<!\.) — evita confundir un acceso a propiedad (`x.mensaje : y` dentro de un
// ternario) con una clave de objeto (`mensaje: 'y'`); ambos lucen igual sin él.
const TS_PROP_LITERAL_RE = /(?<!\.)\b(?:placeholder|label|titulo|texto|mensaje)\s*:\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const TS_PROP_T_RE = /(?<!\.)\b(?:placeholder|label|titulo|texto|mensaje)\s*:\s*(?:this\.)?(?:i18n\.)?t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;

// DP-09 — catálogos constantes (`= [{ label: '…' }, …]`) se declaran en
// español a propósito (no congelar el idioma de arranque) y se traducen al
// MOSTRAR (`| t` en la plantilla) — sea el arreglo module-level o un campo
// de la clase (`secciones = [...]`, `readonly temas = [...]`, etc.). Devuelve
// los rangos [inicio,fin) de cada arreglo `= [ ... ]` (balanceando corchetes)
// para excluir sus props de la cuenta de ".ts sin t()".
function spansDeArreglos(ts) {
  const spans = [];
  // `const x = [...]` / `campo = [...]` (arreglo literal completo) — también
  // `campo = computed(() => [...])`, donde el arreglo no sigue al `=`
  // directamente sino a un `=>` de la función flecha que lo envuelve.
  const reArreglo = /(?:=>|=)\s*\[/g;
  let m;
  while ((m = reArreglo.exec(ts))) {
    const inicio = m.index + m[0].length - 1; // posición del '['
    let profundidad = 1;
    let i = inicio + 1;
    while (i < ts.length && profundidad > 0) {
      if (ts[i] === '[') profundidad++;
      else if (ts[i] === ']') profundidad--;
      i++;
    }
    spans.push([inicio, i]);
  }
  // `campo: Record<K, { label: '…' }> = {...}` — catálogo-mapa (no arreglo):
  // mismo DP-09, se traduce al mostrar (`FASE_META[x] | t`), no al declarar.
  // Acotado a `Record<` para no exentar cualquier objeto literal de la clase;
  // el tipo genérico se balancea por `<`/`>` (puede llevar `;`/`,` adentro).
  const reRecordStart = /:\s*Record</g;
  while ((m = reRecordStart.exec(ts))) {
    let i = m.index + m[0].length; // justo después de 'Record<'
    let prof = 1;
    while (i < ts.length && prof > 0) {
      if (ts[i] === '<') prof++;
      else if (ts[i] === '>') prof--;
      i++;
    }
    // Tras el '>' de cierre, debe seguir `= {` (si no, no es la declaración completa).
    const resto = ts.slice(i, i + 20);
    const eq = resto.match(/^\s*=\s*\{/);
    if (!eq) continue;
    const inicio = i + eq[0].length - 1; // posición del '{'
    let profundidad = 1;
    let j = inicio + 1;
    while (j < ts.length && profundidad > 0) {
      if (ts[j] === '{') profundidad++;
      else if (ts[j] === '}') profundidad--;
      j++;
    }
    spans.push([inicio, j]);
  }
  // `algo.push({...})` — sigue extendiendo el mismo catálogo condicionalmente.
  const rePush = /\.push\(/g;
  while ((m = rePush.exec(ts))) {
    const inicio = m.index + m[0].length - 1; // posición del '('
    let profundidad = 1;
    let i = inicio + 1;
    while (i < ts.length && profundidad > 0) {
      if (ts[i] === '(') profundidad++;
      else if (ts[i] === ')') profundidad--;
      i++;
    }
    spans.push([inicio, i]);
  }
  return spans;
}
function dentroDeAlgunSpan(spans, idx) {
  return spans.some(([s, e]) => idx >= s && idx < e);
}

function extraerLiteralesTs(ts) {
  const items = [];
  let m;
  const spansArreglos = spansDeArreglos(ts);
  TS_LLAMADA_LITERAL_RE.lastIndex = 0;
  while ((m = TS_LLAMADA_LITERAL_RE.exec(ts))) {
    const lit = limpiar(m[2]);
    if (!esRuido(lit)) items.push({ texto: lit, cubierto: false });
  }
  TS_LLAMADA_T_RE.lastIndex = 0;
  while ((m = TS_LLAMADA_T_RE.exec(ts))) {
    const lit = limpiar(m[2]);
    if (!esRuido(lit)) items.push({ texto: lit, cubierto: true });
  }
  TS_CONFIRM_RE.lastIndex = 0;
  while ((m = TS_CONFIRM_RE.exec(ts))) {
    const lit = limpiar(m[2]);
    if (!esRuido(lit)) items.push({ texto: lit, cubierto: false });
  }
  TS_PROP_LITERAL_RE.lastIndex = 0;
  while ((m = TS_PROP_LITERAL_RE.exec(ts))) {
    if (dentroDeAlgunSpan(spansArreglos, m.index)) continue; // catálogo — se traduce al mostrar
    if (m[1] === '`' && m[2].includes('${')) continue; // template literal con datos (`${x.nombre}`), no es copy
    const lit = limpiar(m[2]);
    if (!esRuido(lit)) items.push({ texto: lit, cubierto: false });
  }
  TS_PROP_T_RE.lastIndex = 0;
  while ((m = TS_PROP_T_RE.exec(ts))) {
    const lit = limpiar(m[2]);
    if (!esRuido(lit)) items.push({ texto: lit, cubierto: true });
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

function walkTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(full);
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
const porArchivoTs = new Map(); // ruta .ts → { total, cubiertos, sin: [] } (DP-07c)

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

// DP-07c — literales en .ts, agregados a la MISMA pantalla (ajustes/errores/labels
// no cableados porque viven en el componente, no en el template).
const tsFiles = existsSync(PAGES) ? walkTs(PAGES) : [];
for (const f of tsFiles) {
  const pant = pantallaDe(f);
  const items = extraerLiteralesTs(readFileSync(f, 'utf8'));
  if (!items.length) continue;
  if (!porPantalla.has(pant)) porPantalla.set(pant, { total: 0, cubiertos: 0, sin: [] });
  const acc = porPantalla.get(pant);
  const relF = relative(ROOT, f).split(sep).join('/');
  const accTs = { total: 0, cubiertos: 0, sin: [] };
  for (const it of items) {
    acc.total++;
    accTs.total++;
    if (it.cubierto) {
      acc.cubiertos++;
      accTs.cubiertos++;
    } else {
      acc.sin.push(it.texto);
      accTs.sin.push(it.texto);
    }
  }
  porArchivoTs.set(relF, accTs);
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

// DP-07c — detalle por archivo .ts (toasts/confirm/alert/placeholder/label/
// titulo/mensaje sin t()), solo los archivos con algo pendiente.
const tsFilasConPendientes = [...porArchivoTs.entries()]
  .map(([archivo, a]) => ({ archivo, total: a.total, cubiertos: a.cubiertos, sin: a.total - a.cubiertos, faltantes: a.sin }))
  .filter((f) => f.sin > 0)
  .sort((a, b) => b.sin - a.sin);
if (tsFilasConPendientes.length) {
  md.push('');
  md.push('## Literales en `.ts` sin `t()` (DP-07c — toasts/confirm/alert/placeholder/label/titulo/mensaje)');
  md.push('');
  md.push(`**${tsFilasConPendientes.reduce((s, f) => s + f.sin, 0)} literal(es) sin t()** en ${tsFilasConPendientes.length} archivo(s) (de ${porArchivoTs.size} archivo(s) .ts con algo detectado).`);
  md.push('');
  md.push('| Archivo | sin t() | ejemplos |');
  md.push('|---|---:|---|');
  for (const f of tsFilasConPendientes) {
    md.push(`| ${f.archivo} | ${f.sin} | ${f.faltantes.slice(0, 3).join(' · ')}${f.faltantes.length > 3 ? ' …' : ''} |`);
  }
}
writeFileSync(join(ROOT, 'docs', 'I18N-COVERAGE.md'), md.join('\n') + '\n');
writeFileSync(join(ROOT, 'docs', 'i18n-coverage.json'), JSON.stringify({ pctScopeEn, pctHt, filas }, null, 2));

// Constante para el selector honesto (DP-12: umbral 100/100, nunca "ok" a mano).
const gen =
  `// Generado por scripts/i18n-coverage.mjs — NO editar a mano (BT2, regla 17).\n` +
  `export const I18N_COVERAGE = { en: ${pctScopeEn}, ht: ${pctHt} } as const;\n` +
  `export const I18N_UMBRAL = { en: 100, ht: 100 } as const;\n`;
writeFileSync(join(SRC, 'shared', 'i18n', 'i18n-coverage.generated.ts'), gen);

// DP-07d — alcance.json pasa a TODAS las pantallas detectadas (generado por el
// escáner, no a mano). `enforce` de una pantalla ya existente se PRESERVA (lo
// activa F3/F4 por lote); una pantalla nueva entra con `enforce:false`.
const alcanceNuevo = {
  _doc: 'DP-07d/DP-13 (CONTEXTO-72) — TODAS las pantallas medidas por scripts/i18n-coverage.mjs están en alcance. `enforce:true` rompe el build (guard verify-i18n.mjs) si la pantalla tiene literales (HTML o .ts) sin t(). Generado por el escáner en cada corrida — no editar a mano salvo el campo `enforce` (se activa por lote a medida que el módulo llega a 100%, ver docs/I18N-AVANCE.md).',
  pantallas: Object.fromEntries(
    filas.map((f) => [f.pantalla, { enforce: !!ALCANCE.pantallas?.[f.pantalla]?.enforce }]),
  ),
};
writeFileSync(join(SRC, 'app', 'core', 'i18n', 'alcance.json'), JSON.stringify(alcanceNuevo, null, 2) + '\n');

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
