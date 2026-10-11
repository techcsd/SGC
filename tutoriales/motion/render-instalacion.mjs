// Renderiza un video de instalación (teléfono, voz Ramona).
//   node render-instalacion.mjs android | iphone
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sintetizar, VOZ_DEFAULT, hayLlaveAzure } from '../lib/voz.mjs';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');
const { execFileSync } = require('node:child_process');
const AQUI = dirname(fileURLToPath(import.meta.url));
const FPS = 30, PAD_S = 0.75, MIN_S = 2.3;

const id = process.argv[2] || 'android';
const { PASOS, SCREEN } = await import(`./src/instalaciones/${id}.data.mjs`);

function durMs(file) {
  try { execFileSync(FFMPEG, ['-i', file], { stdio: 'pipe' }); } catch (e) {
    const m = String(e.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+m[4]) * 10;
  }
  return 2500;
}
if (!hayLlaveAzure()) console.log('⚠️  Sin AZURE_SPEECH_KEY → voz BORRADOR.');

const vozDir = resolve(AQUI, 'public', 'voz', SCREEN);
mkdirSync(vozDir, { recursive: true });
let at = 0; const timed = [];
for (const p of PASOS) {
  const { file } = await sintetizar(p.voz, { voz: VOZ_DEFAULT });
  copyFileSync(file, resolve(vozDir, `paso-${p.fase}.mp3`));
  const durF = Math.round(Math.max(MIN_S, durMs(file) / 1000 + PAD_S) * FPS);
  timed.push({ fase: p.fase, at, dur: durF, cap: p.cap, cam: p.cam, click: !!p.click, voz: `paso-${p.fase}.mp3` });
  at += durF;
}
console.log(`Total ≈ ${(at / FPS).toFixed(1)}s`);

const out = resolve(AQUI, 'salida', `instalacion-${id}-v1.mp4`);
mkdirSync(dirname(out), { recursive: true });
console.log('Empaquetando…');
const serveUrl = await bundle({ entryPoint: resolve(AQUI, 'src', 'index.ts') });
const inputProps = { screen: SCREEN, pasos: timed };
const composition = await selectComposition({ serveUrl, id: 'Instalacion', inputProps });
console.log(`Render ${composition.durationInFrames} frames → ${out}`);
let lastp = -1;
await renderMedia({ serveUrl, composition, codec: 'h264', outputLocation: out, inputProps, onProgress: ({ progress }) => { const p = Math.round(progress * 100); if (p !== lastp && p % 10 === 0) { lastp = p; console.log(`  ${p}%`); } } });
console.log(`✓ ${out}`);
