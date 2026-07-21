// Y1 — Guard de versionado (paridad con el release de la app móvil).
// FALLA el build/deploy si la versión actual de package.json NO tiene una entrada
// estructurada en release-notes.json (web.<version> con título + cambios[{t,d}]).
// Así, toda versión que llega a `ng build` (y por tanto a un deploy en Vercel /
// push a main) queda garantizada de registrarse en el historial con sus cambios.
// Se ejecuta en el hook `prebuild` ANTES de gen-version.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIPOS = ['nuevo', 'mejora', 'arreglo', 'seguridad'];

function fail(msg) {
  console.error('\n[verify-version-notes] ❌ ' + msg);
  console.error(
    '\nRegla Y1: toda versión que se sube a main debe registrarse en el historial.\n' +
      'Antes de subir la versión:\n' +
      '  1. Bump `version` en package.json.\n' +
      '  2. Agrega la entrada en release-notes.json bajo `web.<version>`:\n' +
      '       { "titulo": "...", "cambios": [ { "t": "nuevo|mejora|arreglo|seguridad", "d": "..." } ] }\n' +
      '  Ver VERSIONADO.md.\n',
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

let notes;
try {
  notes = JSON.parse(readFileSync(join(root, 'release-notes.json'), 'utf8'));
} catch {
  fail('No se pudo leer release-notes.json.');
}

const entry = notes?.web?.[version];
if (!entry) fail(`Falta la entrada release-notes.json → web["${version}"].`);
if (typeof entry.titulo !== 'string' || !entry.titulo.trim())
  fail(`web["${version}"].titulo está vacío.`);
if (!Array.isArray(entry.cambios) || entry.cambios.length === 0)
  fail(`web["${version}"].cambios debe tener al menos un cambio.`);

entry.cambios.forEach((c, i) => {
  if (!c || typeof c !== 'object') fail(`web["${version}"].cambios[${i}] no es un objeto.`);
  if (!TIPOS.includes(c.t)) fail(`web["${version}"].cambios[${i}].t debe ser uno de ${TIPOS.join(', ')} (recibido: ${c.t}).`);
  if (typeof c.d !== 'string' || !c.d.trim()) fail(`web["${version}"].cambios[${i}].d está vacío.`);
});

console.log(`[verify-version-notes] ✓ v${version} — ${entry.cambios.length} cambio(s) estructurado(s).`);
