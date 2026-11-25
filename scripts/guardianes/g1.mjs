// CLI de G1.  node scripts/guardianes/g1.mjs --base origin/dev --head HEAD [--build ok|fail] [--tests ok|fail] [--salida g1.json]
// Límites: env G1_MAX_ARCHIVOS / G1_MAX_LINEAS (vienen de ing_config_leer). Exit: 0 aprobado, 1 rechazado, 2 propuesta (diff grande).
// Imprime el resultado en JSON (sin valores de secretos) y, si hay $GITHUB_OUTPUT, publica veredicto/zona_roja.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { parsearDiff } from './lib/diff.mjs';
import { evaluarG1 } from './lib/g1.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const base = arg('base', 'origin/dev');
const head = arg('head', 'HEAD');
const resultado = (v) => (v === 'ok' ? true : v === 'fail' ? false : null);

const diff = execFileSync('git', ['diff', '--no-color', '-M', '--unified=0', `${base}...${head}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const cambios = parsearDiff(diff);
const r = evaluarG1(cambios, {
  limites: { max_archivos: process.env.G1_MAX_ARCHIVOS, max_lineas: process.env.G1_MAX_LINEAS },
  build: resultado(arg('build')),
  tests: resultado(arg('tests')),
});
const salida = { ...r, archivos: cambios.map((c) => c.ruta) };
const json = JSON.stringify(salida, null, 2);
console.log(json);
const f = arg('salida');
if (f) writeFileSync(f, json);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `veredicto=${r.veredicto}\nzona_roja=${r.zonaRoja.esZonaRoja}\n`);
}
process.exit(r.veredicto === 'aprobado' ? 0 : r.veredicto === 'propuesta' ? 2 : 1);
