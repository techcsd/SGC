// scripts/registro-prueba.test.mjs — DN-14: prueba registroPruebaValido()
// (gate de casilla marcada + "Probado por" en qa/release-<version>.md).
//
//   node scripts/registro-prueba.test.mjs
import { registroPruebaValido } from './lib/registro-prueba.mjs';

const casos = [
  {
    nombre: 'casilla marcada + Probado por con fecha — pasa',
    texto: '# Release 1.213.0\n- [x] Inicio funciona\n- Probado por: Xaviel · 2026-11-11\n',
    esperado: true,
  },
  {
    nombre: 'todas las casillas sin marcar — el bug real que release-check dejaba pasar',
    texto: '# Release 1.213.0\n- [ ] Inicio funciona\n- [ ] Skills funciona\n- Probado por: Xaviel · 2026-11-11\n',
    esperado: false,
  },
  {
    nombre: 'casilla marcada pero sin línea "Probado por"',
    texto: '# Release 1.213.0\n- [x] Inicio funciona\n- Resultado: OK\n',
    esperado: false,
  },
  {
    nombre: '"Probado por" presente pero sin fecha',
    texto: '# Release 1.213.0\n- [x] Inicio funciona\n- Probado por: Xaviel\n',
    esperado: false,
  },
  {
    nombre: 'sin casillas en absoluto y sin Probado por',
    texto: '# Release 1.213.0\n- Qué se probó: nada todavía\n',
    esperado: false,
  },
];

let fails = 0;
for (const c of casos) {
  const { ok } = registroPruebaValido(c.texto);
  const pasa = ok === c.esperado;
  console.log(`${pasa ? '✅' : '🔴'} ${c.nombre} — esperado=${c.esperado} real=${ok}`);
  if (!pasa) fails++;
}
console.log(`\n${casos.length - fails}/${casos.length} casos OK.`);
if (fails) process.exit(1);
