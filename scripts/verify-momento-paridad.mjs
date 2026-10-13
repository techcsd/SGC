// verify-momento-paridad.mjs — GUARDA CN (FASE 4.4): cada tipo de momento de la app
// debe tener su disparador en la web. Lee los `MomentoTipo` de motion.service.ts y falla
// el build si alguno NO se dispara (`momento('<tipo>')`) en ningún lado de `src/app`.
// Así la paridad app↔web (docs/MOVIMIENTO.md) no se rompe en silencio.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Tipos de momento (de la unión MomentoTipo en motion.service.ts).
const motion = readFileSync(join(ROOT, 'src/shared/services/motion.service.ts'), 'utf8');
const m = motion.match(/export type MomentoTipo\s*=([\s\S]*?);/);
if (!m) { console.error('🔴 verify-momento-paridad: no encontré MomentoTipo en motion.service.ts'); process.exit(1); }
const tipos = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);

// Junta todo el código de src/app (y shared) para buscar los disparadores.
function leer(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) leer(p, acc);
    else if (/\.ts$/.test(e) && !/\.spec\.ts$/.test(e)) acc.push(readFileSync(p, 'utf8'));
  }
  return acc;
}
const codigo = leer(join(ROOT, 'src/app')).concat(leer(join(ROOT, 'src/shared'))).join('\n');

const faltan = tipos.filter((t) => !new RegExp(`momento\\(\\s*['\`]${t}['\`]`).test(codigo));
if (faltan.length) {
  console.error(`🔴 verify-momento-paridad: tipos de momento SIN disparador en la web: ${faltan.join(', ')}`);
  console.error('   Cada MomentoTipo debe dispararse al menos una vez (paridad con la app — docs/MOVIMIENTO.md FASE 4.1).');
  process.exit(1);
}
console.log(`✓ momento-paridad: ${tipos.length} tipos de momento tienen disparador en la web.`);
