// Renderiza la composición "Demo" (mockup guiado: cámara que sigue el cursor).
//   node render-demo.mjs [salida.mp4]
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const out = resolve(AQUI, 'salida', process.argv[2] || 'demo-guiado-v1.mp4');
mkdirSync(dirname(out), { recursive: true });

console.log('Empaquetando…');
const serveUrl = await bundle({ entryPoint: resolve(AQUI, 'src', 'index.ts') });
const composition = await selectComposition({ serveUrl, id: 'Demo' });
console.log(`Render ${composition.durationInFrames} frames @ ${composition.fps}fps → ${out}`);
let last = -1;
await renderMedia({
  serveUrl, composition, codec: 'h264', outputLocation: out,
  onProgress: ({ progress }) => { const p = Math.round(progress * 100); if (p !== last && p % 10 === 0) { last = p; console.log(`  ${p}%`); } },
});
console.log(`✓ ${out}`);
