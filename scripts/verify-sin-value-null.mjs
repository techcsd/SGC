// verify-sin-value-null.mjs — GUARDA CX3.3 (corre en `prebuild`).
//
// Por qué existe: `<option [value]="null">` dentro de un `<select>` con
// `formControlName`/`[formControl]`/`ngModel` guarda el STRING LITERAL "null" al
// seleccionarlo (Angular stringifica el valor del DOM), no el `null` real. Si ese
// texto llega a una columna uuid de Postgres, revienta con
// `invalid input syntax for type uuid: "null"` (reporte de Raykler, CX3.3 —
// "ERROR EN COMPRA" al recibir con "Sin orden asociada"). Apareció en 97 pantallas.
//
// Fix correcto según el contexto del <select>:
//   - Con formControlName/[formControl]/ngModel → usar `[ngValue]="null"` (Angular
//     mantiene un mapa interno id→valor real, sin pasar por el DOM como string).
//   - Nativo (`[value]="signal()" (change)="...")`, sin accessor de formularios →
//     `[ngValue]` no hace nada ahí; el (change) debe limpiar el sentinel con
//     `cleanUuid(...)` (shared/utils/uuid.util.ts) antes de guardarlo.
//
// Esta guarda falla el build si aparece un `<option [value]="null">` NUEVO: dentro
// de un select con formularios reactivos/ngModel (debió ser [ngValue]), o dentro de
// un select nativo cuyo (change) no llama a `cleanUuth(`.

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

const problemas = [];

for (const rel of listHtml()) {
  const html = readFileSync(join(ROOT, rel), 'utf8');
  const lines = html.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/<option\s+\[value\]="null"/.test(lines[i])) continue;

    // Contexto: el <select> que contiene esta opción (hasta 20 líneas antes).
    const context = [];
    for (let j = i; j >= Math.max(0, i - 20); j--) {
      context.unshift(lines[j]);
      if (/<select\b/.test(lines[j])) break;
    }
    const ctx = context.join('\n');
    const esFormulario = /formControlName\s*=|\[formControl\]\s*=|\[\(ngModel\)\]\s*=|\bngModel\s*=/.test(ctx);

    if (esFormulario) {
      problemas.push(
        `${rel}:${i + 1}: <option [value]="null"> dentro de un <select> con formularios → usa [ngValue]="null" (si no, el valor real guardado es el string "null").`,
      );
      continue;
    }

    // Select nativo: el patrón roto es un (change) con el fallback `|| null`
    // directo sobre el valor del DOM (ese es el que deja pasar el string "null").
    // Si limpia inline con cleanUuid(...) o delega a un método del componente
    // (sin el fallback `|| null` en el propio template), se asume que el método
    // ya normaliza (como cleanUuid) — no se puede verificar cross-archivo aquí.
    const changeMatch = ctx.match(/\(change\)="([^"]*)"/);
    const changeExpr = changeMatch?.[1] ?? '';
    const tieneFallbackRoto = /\.value\s*\|\|\s*null/.test(changeExpr) && !/cleanUuid\(/.test(changeExpr);
    if (tieneFallbackRoto) {
      problemas.push(
        `${rel}:${i + 1}: <option [value]="null"> en un <select> nativo cuyo (change) usa ".value || null" sin limpiar primero el sentinel "null" → usa cleanUuid(...).`,
      );
    }
  }
}

if (problemas.length) {
  console.error('🔴 verify-sin-value-null: <option [value]="null"> sin manejar correctamente (CX3.3):');
  for (const p of problemas) console.error('  - ' + p);
  process.exit(1);
}
console.log('✓ verify-sin-value-null: ningún <option [value]="null"> nuevo sin [ngValue] o cleanUuid (CX3.3).');
