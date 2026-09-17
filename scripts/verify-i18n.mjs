/**
 * BS4 — guard de i18n para el prebuild (junto a verify-tokens/verify-dev-strings).
 *
 * Diseño: las CLAVES de traducción SON el texto en español (I18nService.t()), así
 * que `es` funciona sin catálogo y NUNCA falta una clave — no hay "clave usada que
 * no exista en es". Por eso este guard:
 *   1) FALLA si `public/i18n/en.json` o `ht.json` no existen o no parsean (un JSON
 *      roto rompería la carga del idioma en runtime).
 *   2) AVISA (no falla) cuántos textos usados con `| t` / `i18n.t('…')` aún no están
 *      traducidos en `en` — señal de cobertura, no error (caen a español).
 *
 * Baseline como verify-tokens: la web arranca en español y se traduce incremental.
 * Portado del hijo (csd-app) — ver PARIDAD.md.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
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

// 2) Recolecta los textos usados con el pipe `| t` o el servicio `i18n.t('…')`.
const usados = new Set();
const PIPE_RE = /(['"])((?:\\.|(?!\1).)*?)\1\s*\|\s*t\b/g;
const CALL_RE = /\.t\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (/\.(html|ts)$/.test(name)) {
      const txt = readFileSync(full, 'utf8');
      for (const re of [PIPE_RE, CALL_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(txt))) {
          const s = m[2].replace(/\\(['"])/g, '$1').trim();
          if (s) usados.add(s);
        }
      }
    }
  }
}
walk(SRC);

const sinTraducir = [...usados].filter((s) => !(s in catalogs.en));
console.log(
  `\x1b[32m✓ verify-i18n:\x1b[0m ${usados.size} textos con t(); en.json cubre ${usados.size - sinTraducir.length}.`,
);
if (sinTraducir.length) {
  console.log(`\x1b[33m  aviso: ${sinTraducir.length} sin traducir en 'en' (caen a español):\x1b[0m`);
  for (const s of sinTraducir.slice(0, 20)) console.log(`    · ${s}`);
  if (sinTraducir.length > 20) console.log(`    … y ${sinTraducir.length - 20} más`);
}
process.exit(0);
