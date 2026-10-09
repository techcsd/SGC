// CK5 — cargador de guiones. Uso:
//   node run.mjs web-apoyo-transporte      # un video
//   node run.mjs --all                     # todos los guiones web
//   node run.mjs --all --plataforma=app    # (cuando existan guiones de app)
// Graba SOLO en dev con usuario demo (ver lib/privacy-lock.mjs y docs/TUTORIALES.md).
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { grabarGuion } from './lib/record.mjs';

const args = process.argv.slice(2);
const all = args.includes('--all');
const plataforma = (args.find((a) => a.startsWith('--plataforma=')) || '').split('=')[1] || 'web';
const ids = args.filter((a) => !a.startsWith('--'));

async function cargar(id) {
  const mod = await import(pathToFileURL(resolve('guiones', `${id}.mjs`)).href);
  return mod.default;
}

function listarGuiones() {
  return readdirSync('guiones')
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => f.replace(/\.mjs$/, ''));
}

async function main() {
  let objetivos = ids;
  if (all) {
    objetivos = listarGuiones().filter((id) => id.startsWith(`${plataforma}-`));
  }
  if (!objetivos.length) {
    console.error('Nada que grabar. Pasa un id de guion o --all.');
    console.error('Guiones disponibles:', listarGuiones().join(', ') || '(ninguno)');
    process.exit(1);
  }

  const resultados = [];
  for (const id of objetivos) {
    console.log(`\n═══ Grabando: ${id} ═══`);
    try {
      const g = await cargar(id);
      const r = await grabarGuion(g, {});
      resultados.push({ id, ...r, ok: true });
    } catch (e) {
      console.error(`✗ ${id}:`, e.message);
      resultados.push({ id, ok: false, error: e.message });
    }
  }

  console.log('\n═══ Resumen ═══');
  for (const r of resultados) {
    console.log(r.ok ? `✓ ${r.id} (${r.duracion_s}s) → ${r.mp4}` : `✗ ${r.id}: ${r.error}`);
  }
  if (resultados.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
