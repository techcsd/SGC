// Renderiza un tutorial (estilo guiado, voz Ramona es-DO). Sintetiza la voz de cada
// paso, mide su duración para sincronizar cámara/cursor/caption, y renderiza a mp4.
//
//   node render-tutorial.mjs crear-requisicion
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sintetizar, VOZ_DEFAULT, hayLlaveAzure } from '../lib/voz.mjs';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');
const { execFileSync } = require('node:child_process');

const AQUI = dirname(fileURLToPath(import.meta.url));
const FPS = 30, PAD_S = 0.75, MIN_S = 2.3;

const id = process.argv[2] || 'crear-requisicion';
const { PASOS, SCREEN, TITULO } = await import(`./src/tutoriales/${id}.data.mjs`);

function durMs(file) {
  try { execFileSync(FFMPEG, ['-i', file], { stdio: 'pipe' }); } catch (e) {
    const m = String(e.stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+m[4]) * 10;
  }
  return 2500;
}

if (!hayLlaveAzure()) console.log('⚠️  Sin AZURE_SPEECH_KEY → voz BORRADOR (edge-tts). No subir a prod.');

const vozDir = resolve(AQUI, 'public', 'voz', SCREEN);
mkdirSync(vozDir, { recursive: true });

// 1) Voz por paso + timings.
let at = 0; const timed = []; let borrador = false;
for (const p of PASOS) {
  const { file, borrador: b } = await sintetizar(p.voz, { voz: VOZ_DEFAULT });
  borrador = borrador || b;
  const dest = resolve(vozDir, `paso-${p.fase}.mp3`);
  copyFileSync(file, dest);
  const durS = Math.max(MIN_S, durMs(file) / 1000 + PAD_S);
  const durF = Math.round(durS * FPS);
  timed.push({ fase: p.fase, at, dur: durF, cap: p.cap, cam: p.cam, click: !!p.click, voz: `paso-${p.fase}.mp3` });
  console.log(`  paso ${p.fase}: ${(durS).toFixed(1)}s @frame ${at}`);
  at += durF;
}
console.log(`Total ≈ ${(at / FPS).toFixed(1)}s`);

// 2) Render.
const out = resolve(AQUI, 'salida', `tutorial-${id}-v1.mp4`);
mkdirSync(dirname(out), { recursive: true });
console.log('Empaquetando…');
const serveUrl = await bundle({ entryPoint: resolve(AQUI, 'src', 'index.ts') });
const inputProps = { screen: SCREEN, pasos: timed, conMusica: true };
const composition = await selectComposition({ serveUrl, id: 'Tutorial', inputProps });
console.log(`Render ${composition.durationInFrames} frames → ${out}`);
let lastp = -1;
await renderMedia({
  serveUrl, composition, codec: 'h264', outputLocation: out, inputProps,
  onProgress: ({ progress }) => { const p = Math.round(progress * 100); if (p !== lastp && p % 10 === 0) { lastp = p; console.log(`  ${p}%`); } },
});
console.log(`✓ ${out}`);
if (borrador) console.log('⚠️  VOZ BORRADOR — no subir a prod.');
