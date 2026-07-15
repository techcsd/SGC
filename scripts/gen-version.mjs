// W7 — Genera src/environments/version.ts desde package.json.
// Se ejecuta como hook prebuild/prestart (npm), así la versión del bundle sale
// SIEMPRE de package.json y la app la auto-registra en el historial al arrancar.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out =
  `// AUTO-GENERADO por scripts/gen-version.mjs (hook prebuild/prestart). No editar a mano.\n` +
  `export const APP_VERSION = '${pkg.version}';\n`;
writeFileSync(join(root, 'src', 'environments', 'version.ts'), out);
console.log('[gen-version] version.ts →', pkg.version);
