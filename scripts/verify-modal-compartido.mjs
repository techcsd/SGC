// verify-modal-compartido.mjs — GUARDA CF3 (corre en `prebuild`).
//
// Por qué existe: los modales "Posibles duplicados" y "Papelera" de Personal de obra
// usaban las clases `.pob-docmodal*` que SÓLO existen en personal-expediente.scss.
// Angular encapsula los estilos por componente, así que en la LISTA el modal salía sin
// overlay ni posición —un bloque suelto al final de la página—, y al hacer clic "no
// pasaba nada".  Fix: usar el componente compartido <app-form-drawer>.
//
// Esta guarda hace el patrón imposible de reintroducir: una clase de overlay de modal
// (token que contiene `docmodal` o termina en `-modal`/`__modal` usado como contenedor)
// debe estar DEFINIDA con `position: fixed`/`inset` en el .scss co-ubicado de ESE
// componente.  Si un template la usa pero su propio .scss no la define → el overlay no
// se pinta en ese componente → falla el build.  Lo correcto es <app-form-drawer>.
//
// Deliberadamente acotada: sólo mira clases de overlay (no toda clase con "modal" en el
// nombre) y resuelve el .scss co-ubicado (convención name.html + name.scss).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Tokens de overlay de modal hechos a mano (NO componentes compartidos). Ampliable.
const OVERLAY_TOKENS = [/\bdocmodal\b/, /[\w-]*-modal-overlay\b/, /[\w-]*__overlay\b/];

function listHtml() {
  const out = execSync('git ls-files "src/**/*.html"', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const problemas = [];
for (const rel of listHtml()) {
  const htmlPath = join(ROOT, rel);
  const html = readFileSync(htmlPath, 'utf8');
  // Clases usadas en el template (class="..." estático).
  const clases = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const tok of m[1].split(/\s+/)) if (tok) clases.add(tok);
  }
  const overlayTokens = [...clases].filter((c) => OVERLAY_TOKENS.some((re) => re.test(c)));
  if (!overlayTokens.length) continue;

  const scssPath = htmlPath.replace(/\.html$/, '.scss');
  const scss = existsSync(scssPath) ? readFileSync(scssPath, 'utf8') : '';
  for (const tok of overlayTokens) {
    // ¿El .scss co-ubicado define este overlay con posicionamiento fijo?
    // Soporta forma plana (.pob-docmodal { position:fixed }) y anidada SCSS
    // (.pob-docmodal { ... } con position:fixed dentro del mismo bloque base).
    const base = tok.replace(/__.*$/, '').replace(/(-modal-overlay|__overlay)$/, '');
    const defineBase = new RegExp(`\\.${base}\\s*\\{[^}]*position:\\s*fixed`, 's').test(scss) ||
      new RegExp(`\\.${tok}\\s*\\{[^}]*position:\\s*fixed`, 's').test(scss);
    if (!defineBase) {
      problemas.push(`${rel}: usa la clase de overlay «${tok}» pero su .scss co-ubicado no la define con position:fixed.\n    → Usa el componente compartido <app-form-drawer> (overlay/focus-trap/a11y ya resueltos).`);
    }
  }
}

if (problemas.length) {
  console.error('🔴 verify-modal-compartido: modal(es) con overlay sin estilo en su propio componente (CF3):');
  for (const p of problemas) console.error('  - ' + p);
  process.exit(1);
}
console.log('✓ verify-modal-compartido: ningún modal con overlay huérfano (usa app-form-drawer).');
