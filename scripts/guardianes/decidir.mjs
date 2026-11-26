// CLI sobre lib/promocion.mjs (decisiones puras) para los workflows.
//   node decidir.mjs promocion  --config config.json --g1 g1.json --g2 aprobado|rechazado --humo ok|fail --hoy N
//   node decidir.mjs reversion  --health ok|fail --smoke ok|fail [--base N] [--ahora N]
// Imprime «clave=valor» (apto para $GITHUB_OUTPUT) y un resumen JSON en la última línea.
import { readFileSync } from 'node:fs';
import { decidirPromocion, decidirReversion } from './lib/promocion.mjs';

const [modo, ...resto] = process.argv.slice(2);
const arg = (n, d) => { const i = resto.indexOf(`--${n}`); return i > -1 ? resto[i + 1] : d; };
const num = (v) => (v === undefined || v === '' || v === 'null' ? null : Number(v));

if (modo === 'promocion') {
  let config = {}; let g1 = { veredicto: 'rechazado', zonaRoja: { esZonaRoja: true } };
  try { config = JSON.parse(readFileSync(arg('config'), 'utf8')); } catch { /* sin config => apagado */ }
  try { g1 = JSON.parse(readFileSync(arg('g1'), 'utf8')); } catch { /* sin g1 => rechazado */ }
  const r = decidirPromocion({ config, zonaRoja: g1.zonaRoja ?? {}, promovidosHoy: Number(arg('hoy', 0)), g1: g1.veredicto, g2: arg('g2', 'rechazado'), humoDev: arg('humo') === 'ok' });
  console.log(`promover=${r.promover}\nrazon=${r.razon}`);
  console.log(JSON.stringify(r));
} else if (modo === 'reversion') {
  const r = decidirReversion({ health: arg('health') === 'ok', smoke: arg('smoke') === 'ok', erroresBase: num(arg('base')), erroresAhora: num(arg('ahora')) });
  console.log(`revertir=${r.revertir}`);
  console.log(JSON.stringify(r));
} else { console.error('Uso: decidir.mjs promocion|reversion ...'); process.exit(1); }
