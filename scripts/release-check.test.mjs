// scripts/release-check.test.mjs — CR3: prueba la función okLineaValida()
// (gate de la línea "OK:" de qa/release-<version>.md) con los 4 casos del
// hallazgo original (HANDOFF de CQ): un "OK de Xaviel (pendiente)" pasaba
// igual que un OK real porque solo se buscaba el texto, sin mirar alrededor.
//
//   node scripts/release-check.test.mjs
import { okLineaValida } from './lib/ok-linea.mjs';

const casos = [
  {
    nombre: 'OK real, con fecha, sin negaciones',
    texto: '# Release 1.194.0\n- Qué se probó: todo\nOK: Xaviel probó en dev.sgcconstructorasd.com el 18-10-2026, todo funcionó.\n',
    esperado: true,
  },
  {
    nombre: '"OK de Xaviel (pendiente)" — el caso real que coló en CQ',
    texto: '# Release 1.191.0\n**OK de Xaviel** (pendiente)\n',
    esperado: false,
  },
  {
    nombre: '"no hay OK de Xaviel todavía"',
    texto: '# Release 1.190.0\nEstado: no hay OK de Xaviel todavía, falta que pruebe.\n',
    esperado: false,
  },
  {
    nombre: 'sin ninguna línea de OK',
    texto: '# Release 1.189.0\n- Qué se probó: nada todavía\n- Resultado: pendiente\n',
    esperado: false,
  },
];

let fails = 0;
for (const c of casos) {
  const real = okLineaValida(c.texto);
  const ok = real === c.esperado;
  console.log(`${ok ? '✅' : '🔴'} ${c.nombre} — esperado=${c.esperado} real=${real}`);
  if (!ok) fails++;
}
console.log(`\n${casos.length - fails}/${casos.length} casos OK.`);
if (fails) process.exit(1);
