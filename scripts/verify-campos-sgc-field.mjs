// verify-campos-sgc-field.mjs — GUARDA CL1 (corre en `prebuild`).
//
// Por qué existe: `.sgc-field` (styles.scss) es el CONTENEDOR de un campo (label +
// control); sus estilos viven en `.sgc-field input|select|textarea`. Poner la clase
// `sgc-field` DIRECTAMENTE en un `<input>`, `<select>` o `<textarea>` deja el control
// NATIVO sin estilo (el "cavernícola" de la nota #185: select gris del sistema, inputs
// de 1px, sin alto ni radio ni foco). Pasó en 17 controles de 5 pantallas.
//
// Fix correcto: el control SUELTO usa `sgc-input` (input/textarea) o `select.sgc-select`
// (ambos definidos en styles.scss), o se envuelve en `<div class="sgc-field">`.
//
// Esta guarda hace imposible reintroducir el patrón: falla el build si algún
// `<input|select|textarea …>` lleva la clase `sgc-field` (en cualquier línea del tag).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function listHtml() {
  const out = execSync('git ls-files "src/**/*.html"', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Captura el tag de apertura completo de input/select/textarea (puede abarcar varias
// líneas) y comprueba si en su atributo class aparece el token `sgc-field`.
const TAG_RE = /<(input|select|textarea)\b[^>]*>/gis;
const problemas = [];

for (const rel of listHtml()) {
  const html = readFileSync(join(ROOT, rel), 'utf8');
  for (const m of html.matchAll(TAG_RE)) {
    const tag = m[0];
    const cls = tag.match(/class="([^"]*)"/i);
    if (!cls) continue;
    const tokens = cls[1].split(/\s+/);
    if (tokens.includes('sgc-field')) {
      const linea = html.slice(0, m.index).split('\n').length;
      problemas.push(`${rel}:${linea}: <${m[1]}> lleva la clase «sgc-field» (es el contenedor, no el control).\n    → Usa «sgc-input» (input/textarea) o «sgc-select» (select), o envuélvelo en <div class="sgc-field">.`);
    }
  }
}

if (problemas.length) {
  console.error('🔴 verify-campos-sgc-field: control(es) con «sgc-field» directo → saldrían sin estilo (CL1):');
  for (const p of problemas) console.error('  - ' + p);
  process.exit(1);
}
console.log('✓ verify-campos-sgc-field: ningún control usa «sgc-field» como clase (CL1).');
