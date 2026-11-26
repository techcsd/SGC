// node scripts/guardianes/extraer.mjs <archivo> [campo]
// Extrae el objeto JSON de la respuesta de Claude Code (--output-format json envuelve el texto en { result }).
// Con campo imprime ese valor (objetos/arreglos como JSON); sin campo, el objeto completo. Exit 1 si no hay JSON.
//   node extraer.mjs out.json costo   -> total_cost_usd del envoltorio del CLI
import { readFileSync } from 'node:fs';
import { extraerJson } from './lib/veredicto.mjs';

const [archivo, campo] = process.argv.slice(2);
let texto = '';
try { texto = readFileSync(archivo, 'utf8'); } catch { process.exit(1); }
if (campo === 'costo') {
  try { console.log(Number(JSON.parse(texto).total_cost_usd) || 0); } catch { console.log(0); }
  process.exit(0);
}
const o = extraerJson(texto);
if (!o) process.exit(1);
if (!campo) { console.log(JSON.stringify(o)); process.exit(0); }
const v = o[campo];
console.log(v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? '');
