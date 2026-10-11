// tutoriales/lib/voz.mjs — CM3 — voz sintética dominicana (Azure Speech, nivel F0).
// Genera el audio de cada frase del guion con `es-DO-RamonaNeural` (alterna `EmilioNeural`),
// con caché por hash del texto (no re-sintetiza si no cambió). Sin llave de Azure, cae a
// `edge-tts` SOLO como BORRADOR (no se sube a prod — lo marca el flag `borrador`).
//
//   import { sintetizar, VOZ_DEFAULT } from './lib/voz.mjs';
//   const { file, borrador } = await sintetizar('Hola, vamos a crear un conduce.');
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const AQUI = dirname(fileURLToPath(import.meta.url)); // tutoriales/lib

// Carga .env.local (AZURE_SPEECH_KEY / AZURE_SPEECH_REGION) sin dependencias. Robusto al
// cwd: busca en la raíz del repo (lib/../../.env.local) y en el cwd como respaldo.
function cargarEnv() {
  for (const f of [resolve(AQUI, '..', '..', '.env.local'), resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '..', '.env.local')]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    break;
  }
}
cargarEnv();

export const VOZ_DEFAULT = 'es-DO-RamonaNeural';
export const VOZ_ALT = 'es-DO-EmilioNeural';
const CACHE = resolve(AQUI, '..', '.voz-cache'); // tutoriales/.voz-cache
const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION || 'eastus';

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function azureTTS(texto, voz) {
  const ssml = `<speak version='1.0' xml:lang='es-DO'><voice name='${voz}'>` +
    `<prosody rate='-4%'>${esc(texto)}</prosody></voice></speak>`;
  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'sgc-tutoriales',
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

function edgeTTS(texto, voz, out) {
  // Borrador local (no prod): requiere `edge-tts` instalado (pip). Si no, lanza.
  execFileSync('edge-tts', ['--voice', voz, '--text', texto, '--write-media', out], { stdio: 'ignore' });
}

/** Sintetiza una frase → { file, borrador }. Cachea por (texto+voz). */
export async function sintetizar(texto, { voz = VOZ_DEFAULT } = {}) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const hash = createHash('sha256').update(voz + '|' + texto).digest('hex').slice(0, 20);
  const file = resolve(CACHE, `${hash}.mp3`);
  const meta = resolve(CACHE, `${hash}.json`);
  if (existsSync(file) && existsSync(meta)) return { file, ...JSON.parse(readFileSync(meta, 'utf8')) };

  let borrador = false;
  if (KEY) {
    writeFileSync(file, await azureTTS(texto, voz));
  } else {
    borrador = true;
    edgeTTS(texto, voz, file); // solo revisión interna
  }
  writeFileSync(meta, JSON.stringify({ borrador, voz }));
  return { file, borrador, voz };
}

export function hayLlaveAzure() { return !!KEY; }
