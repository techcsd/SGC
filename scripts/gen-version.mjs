// W7 / Y1 — Genera src/environments/version.ts desde package.json + release-notes.json.
// Se ejecuta como hook prebuild/prestart (npm), así la versión del bundle sale
// SIEMPRE de package.json y la app la auto-registra en el historial al arrancar
// CON sus notas estructuradas (título + cambios[{t,d}]). Si no hay notas para la
// versión actual, se emiten vacías (el registro sigue funcionando, sin chips).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let titulo = null;
let cambios = [];
try {
  const notes = JSON.parse(readFileSync(join(root, 'release-notes.json'), 'utf8'));
  const entry = notes?.web?.[pkg.version];
  if (entry) {
    titulo = entry.titulo ?? null;
    cambios = Array.isArray(entry.cambios) ? entry.cambios : [];
  }
} catch {
  /* sin release-notes.json: se emiten notas vacías (no bloquea) */
}

const out =
  `// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.\n` +
  `export const APP_VERSION = '${pkg.version}';\n` +
  `export const APP_VERSION_TITULO: string | null = ${JSON.stringify(titulo)};\n` +
  `export const APP_VERSION_CAMBIOS: { t: string; d: string }[] = ${JSON.stringify(cambios)};\n`;
writeFileSync(join(root, 'src', 'environments', 'version.ts'), out);
console.log(`[gen-version] version.ts → ${pkg.version} (${cambios.length} cambios)`);
