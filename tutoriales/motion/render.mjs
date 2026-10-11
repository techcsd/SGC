// SGC motion — renderiza el promo (Remotion) a mp4. Lee las capturas de public/shots/,
// las etiqueta por nombre de archivo y compone el video. Sin CLI interactiva.
//
//   node render.mjs                 (promo general)
//   node render.mjs promo-sgc.mp4   (nombre de salida)
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const shotsDir = resolve(AQUI, 'public', 'shots');
const out = resolve(AQUI, 'salida', process.argv[2] || 'promo-sgc.mp4');
mkdirSync(dirname(out), { recursive: true });

// Etiquetas por archivo de captura (orden = orden de aparición).
const ORDEN = ['dashboard', 'inventario', 'conduces', 'flota', 'proyectos', 'bitacora', 'tareas', 'mensajeria'];
const LABELS = {
  dashboard:  { modulo: 'Panel', beneficio: 'Toda tu operación de un vistazo' },
  inventario: { modulo: 'Inventario', beneficio: 'Material y almacenes, siempre cuadrados' },
  conduces:   { modulo: 'Conduces', beneficio: 'Traza cada entrega, de punta a punta' },
  flota:      { modulo: 'Flota', beneficio: 'Vehículos, combustible y choferes al día' },
  proyectos:  { modulo: 'Proyectos', beneficio: 'Avance y encargados, bajo control' },
  bitacora:   { modulo: 'Bitácora', beneficio: 'El parte diario de la obra, sin papeles' },
  tareas:     { modulo: 'Tareas', beneficio: 'Asigna, sigue y cierra el pendiente' },
  mensajeria: { modulo: 'Mensajería', beneficio: 'Tu equipo, comunicado al instante' },
};

const files = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
  : [];
// Ordena por ORDEN conocido, el resto al final.
const key = (f) => f.replace(/\.(png|jpg|jpeg)$/i, '').toLowerCase();
files.sort((a, b) => {
  const ia = ORDEN.indexOf(key(a)), ib = ORDEN.indexOf(key(b));
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
const shots = files.map((f) => ({ src: f, ...(LABELS[key(f)] || { modulo: 'SGC', beneficio: 'Hecho para tu obra' }) }));

console.log(`Capturas: ${shots.length ? shots.map((s) => s.src).join(', ') : '(ninguna → placeholder)'}`);

const inputProps = { shots };

console.log('Empaquetando (esbuild)…');
const serveUrl = await bundle({ entryPoint: resolve(AQUI, 'src', 'index.ts') });
const composition = await selectComposition({ serveUrl, id: 'Promo', inputProps });
console.log(`Render ${composition.durationInFrames} frames @ ${composition.fps}fps → ${out}`);

let last = -1;
await renderMedia({
  serveUrl, composition, codec: 'h264', outputLocation: out, inputProps,
  onProgress: ({ progress }) => {
    const p = Math.round(progress * 100);
    if (p !== last && p % 10 === 0) { last = p; console.log(`  ${p}%`); }
  },
});
console.log(`✓ ${out}`);
