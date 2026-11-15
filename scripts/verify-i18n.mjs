/**
 * BS4/DP-13 — guard de i18n para el prebuild (junto a verify-tokens/verify-dev-strings).
 *
 * Diseño: las CLAVES de traducción SON el texto en español (I18nService.t()), así
 * que `es` funciona sin catálogo y NUNCA falta una clave — no hay "clave usada que
 * no exista en es". Por eso este guard:
 *   1) FALLA si `public/i18n/en.json` o `ht.json` no existen o no parsean (un JSON
 *      roto rompería la carga del idioma en runtime).
 *   2) FALLA (DP-13a) si una pantalla con `enforce:true` en
 *      `src/app/core/i18n/alcance.json` usa una clave que falta en `en.json` o
 *      `ht.json` — el enforce se activa por lote (ver docs/I18N-AVANCE.md), así
 *      que esto NO rompe el build para las pantallas que aún no llegaron a 100%.
 *   3) AVISA (no falla) el resto: cuántos textos usados en TODO el repo todavía
 *      no están en `en`/`ht` — señal de cobertura, no error (caen a español).
 *
 * Baseline como verify-tokens: la web arranca en español y se traduce incremental.
 * Portado del hijo (csd-app) — ver PARIDAD.md.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const PAGES = join(SRC, 'app', 'pages');
const I18N_DIR = join(ROOT, 'public', 'i18n');

function fail(msg) {
  console.error(`\x1b[31m✗ verify-i18n: ${msg}\x1b[0m`);
  process.exit(1);
}

// 1) Los catálogos de traducción deben existir y parsear.
const catalogs = {};
for (const lang of ['en', 'ht']) {
  const p = join(I18N_DIR, `${lang}.json`);
  if (!existsSync(p)) fail(`falta public/i18n/${lang}.json`);
  try {
    catalogs[lang] = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`public/i18n/${lang}.json no es JSON válido: ${e.message}`);
  }
}

// Alcance (enforce por pantalla) — mismo criterio que scripts/i18n-coverage.mjs.
let ALCANCE = { pantallas: {} };
try {
  ALCANCE = JSON.parse(readFileSync(join(SRC, 'app', 'core', 'i18n', 'alcance.json'), 'utf8'));
} catch { /* opcional */ }
const PANTALLAS_ENFORCE = new Set(
  Object.entries(ALCANCE.pantallas ?? {}).filter(([, v]) => v?.enforce).map(([k]) => k),
);
function pantallaDe(file) {
  const rel = relative(PAGES, file);
  const parts = rel.split(sep);
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/') || parts[0];
}

// 2) Recolecta los textos usados con el pipe `| t` o el servicio `i18n.t('…')`,
// por archivo (para poder atribuirlos a una pantalla).
const PIPE_RE = /(['"])((?:\\.|(?!\1).)*?)\1\s*\|\s*t\b/g;
const CALL_RE = /\.t\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;
// DP-09 — catálogos constantes (`{ label: '…' }` en un arreglo) se muestran
// vía `s.label | t` (variable, no literal) — PIPE_RE/CALL_RE nunca los ven.
// Sin esto, una pantalla `enforce:true` podía pasar el guard con un label de
// catálogo sin traducir (hallazgo real: "Cuenta"/"Privacidad" en `configuracion`,
// atrapado recién por i18n-smoke.mjs, no por este guard).
const PROP_RE = /(?<!\.)\b(?:placeholder|label|titulo|texto|mensaje)\s*:\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;

const usadosGlobal = new Set();
const usadosPorPantalla = new Map(); // pantalla → Set(claves)

function extraerClaves(txt) {
  const claves = new Set();
  for (const re of [PIPE_RE, CALL_RE, PROP_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(txt))) {
      const s = m[2].replace(/\\(['"])/g, '$1').trim();
      if (s) claves.add(s);
    }
  }
  return claves;
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (/\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts')) {
      const txt = readFileSync(full, 'utf8');
      const claves = extraerClaves(txt);
      if (!claves.size) continue;
      for (const c of claves) usadosGlobal.add(c);
      if (full.startsWith(PAGES)) {
        const pant = pantallaDe(full);
        if (!usadosPorPantalla.has(pant)) usadosPorPantalla.set(pant, new Set());
        for (const c of claves) usadosPorPantalla.get(pant).add(c);
      }
    }
  }
}
walk(SRC);

// 2a) DP-13a — pantallas enforce:true: TODA clave usada debe estar en en Y ht.
const fallosEnforce = [];
for (const pant of PANTALLAS_ENFORCE) {
  const claves = usadosPorPantalla.get(pant);
  if (!claves) continue;
  for (const c of claves) {
    const faltaEn = !(c in catalogs.en);
    const faltaHt = !(c in catalogs.ht);
    if (faltaEn || faltaHt) fallosEnforce.push({ pantalla: pant, clave: c, faltaEn, faltaHt });
  }
}
if (fallosEnforce.length) {
  console.error(`\x1b[31m✗ verify-i18n: ${fallosEnforce.length} clave(s) sin traducir en pantalla(s) 'enforce':\x1b[0m`);
  for (const f of fallosEnforce.slice(0, 30)) {
    const falta = [f.faltaEn && 'en', f.faltaHt && 'ht'].filter(Boolean).join('+');
    console.error(`    ${f.pantalla} [falta ${falta}]: "${f.clave}"`);
  }
  if (fallosEnforce.length > 30) console.error(`    … y ${fallosEnforce.length - 30} más`);
  process.exit(1);
}

// 3) Resto del repo: solo aviso (el enforce por lote todavía no las alcanza).
const sinTraducirEn = [...usadosGlobal].filter((s) => !(s in catalogs.en));
const sinTraducirHt = [...usadosGlobal].filter((s) => !(s in catalogs.ht));
console.log(
  `\x1b[32m✓ verify-i18n:\x1b[0m ${usadosGlobal.size} textos con t() · en.json cubre ${usadosGlobal.size - sinTraducirEn.length} ` +
  `· ht.json cubre ${usadosGlobal.size - sinTraducirHt.length} · ${PANTALLAS_ENFORCE.size} pantalla(s) enforce (0 fallos).`,
);
if (sinTraducirEn.length) {
  console.log(`\x1b[33m  aviso: ${sinTraducirEn.length} sin traducir en 'en' (caen a español):\x1b[0m`);
  for (const s of sinTraducirEn.slice(0, 10)) console.log(`    · ${s}`);
  if (sinTraducirEn.length > 10) console.log(`    … y ${sinTraducirEn.length - 10} más`);
}
process.exit(0);
