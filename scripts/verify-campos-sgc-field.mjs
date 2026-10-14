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

// ── CO11 — extensión: control SIN ninguna clase del sistema (ni sgc-input/
// sgc-select, ni envuelto en <div class="sgc-field">), en pages/legal/** y
// pages/documentos/** (mismo defecto de CL1, folders nuevos tocados en CO11-14).
const CARPETAS_EXTENDIDAS = ['src/app/pages/legal/', 'src/app/pages/documentos/'];
const TIPOS_EXENTOS = new Set(['checkbox', 'radio', 'file', 'hidden', 'submit', 'button']);
const sinClaseDelSistema = [];

for (const rel of listHtml()) {
  if (!CARPETAS_EXTENDIDAS.some((c) => rel.startsWith(c))) continue;
  const html = readFileSync(join(ROOT, rel), 'utf8');
  for (const m of html.matchAll(TAG_RE)) {
    const tag = m[0];
    const tipo = tag.match(/type="([^"]*)"/i)?.[1]?.toLowerCase();
    if (tipo && TIPOS_EXENTOS.has(tipo)) continue;
    const cls = tag.match(/class="([^"]*)"/i);
    const tokens = cls ? cls[1].split(/\s+/) : [];
    if (tokens.includes('sgc-input') || tokens.includes('sgc-select')) continue;
    // ¿Envuelto en <div class="sgc-field">? (heurística: el último contenedor
    // sgc-field abierto antes de este tag, sin un </div> de cierre en medio).
    const antes = html.slice(0, m.index);
    const fieldOpenRe = /<div\s+class="sgc-field\b/gi;
    let ultimoFieldOpen = -1;
    for (const fm of antes.matchAll(fieldOpenRe)) ultimoFieldOpen = fm.index;
    const entreMedio = ultimoFieldOpen >= 0 ? antes.slice(ultimoFieldOpen) : '';
    const envuelto = ultimoFieldOpen >= 0 && (entreMedio.match(/<div\b/gi)?.length ?? 0) > (entreMedio.match(/<\/div>/gi)?.length ?? 0);
    if (envuelto) continue;
    const linea = antes.split('\n').length;
    sinClaseDelSistema.push(`${rel}:${linea}: <${m[1]}> sin «sgc-input»/«sgc-select» ni envoltorio «.sgc-field» → sale sin estilo.`);
  }
}

if (problemas.length || sinClaseDelSistema.length) {
  if (problemas.length) {
    console.error('🔴 verify-campos-sgc-field: control(es) con «sgc-field» directo → saldrían sin estilo (CL1):');
    for (const p of problemas) console.error('  - ' + p);
  }
  if (sinClaseDelSistema.length) {
    console.error('🔴 verify-campos-sgc-field: control(es) sin clase del sistema en legal/documentos (CO11):');
    for (const p of sinClaseDelSistema) console.error('  - ' + p);
  }
  process.exit(1);
}
console.log('✓ verify-campos-sgc-field: ningún control usa «sgc-field» como clase (CL1), y legal/documentos tienen piel (CO11).');
