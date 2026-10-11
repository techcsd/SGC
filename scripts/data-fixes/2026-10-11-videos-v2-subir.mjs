// scripts/data-fixes/2026-10-11-videos-v2-subir.mjs — (regla 18/19)
// Sube los videos nuevos (Remotion, estilo guiado) de tutoriales/motion/salida/ al bucket
// privado `tutoriales` y los registra en sgc.ayuda_contenido (tipo 'guia', contenido jsonb)
// para que aparezcan en Dudas con el reproductor (que ahora tiene Descargar/Compartir).
// Los subtítulos van HORNEADOS en el video (no .vtt aparte). Extrae un póster con ffmpeg.
//
//   node scripts/data-fixes/2026-10-11-videos-v2-subir.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-11-videos-v2-subir.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-11-videos-v2-subir.mjs --env prod --apply   (tras OK de Xaviel)
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(resolve('tutoriales', 'package.json'));
const FFMPEG = require('ffmpeg-static');
const { execFileSync } = require('node:child_process');

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');
if (!env.serviceKey) { console.error(`🔴 Falta SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()} en .env.local`); process.exit(1); }

const BUCKET = 'tutoriales';
const SALIDA = resolve('tutoriales', 'motion', 'salida');
const Q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// archivo en salida → guía {slug, titulo, modulo, orden}
const VIDEOS = [
  { file: 'tutorial-crear-requisicion-v1.mp4',       slug: 'requisicion',        titulo: 'Crear una requisición',            modulo: 'inventario', orden: 10 },
  { file: 'tutorial-aprobar-despachar-v1.mp4',       slug: 'aprobar-despachar',  titulo: 'Aprobar y despachar una requisición', modulo: 'inventario', orden: 11 },
  { file: 'tutorial-entrada-inventario-v1.mp4',      slug: 'entrada-inventario', titulo: 'Registrar una entrada de inventario', modulo: 'inventario', orden: 12 },
  { file: 'tutorial-conteo-v1.mp4',                  slug: 'conteo',             titulo: 'Hacer un conteo',                   modulo: 'inventario', orden: 13 },
  { file: 'tutorial-crear-conduce-v1.mp4',           slug: 'conduce',            titulo: 'Crear un conduce',                  modulo: 'inventario', orden: 14 },
  { file: 'tutorial-transferir-conduce-v1.mp4',      slug: 'transferir-conduce', titulo: 'Transferir un conduce',             modulo: 'flota',      orden: 15 },
  { file: 'tutorial-registrar-mantenimiento-v1.mp4', slug: 'mantenimiento',      titulo: 'Registrar un mantenimiento',        modulo: 'flota',      orden: 16 },
  { file: 'tutorial-autorizar-chofer-v1.mp4',        slug: 'chofer-privado',     titulo: 'Autorizar un chofer privado',       modulo: 'flota',      orden: 17 },
  { file: 'tutorial-apoyo-transporte-v1.mp4',        slug: 'apoyo-transporte',   titulo: 'Pedir apoyo de transporte',         modulo: 'flota',      orden: 18 },
  { file: 'tutorial-mis-choferes-v1.mp4',            slug: 'mis-choferes',       titulo: 'Ver y asignar tus choferes',        modulo: 'flota',      orden: 19 },
  { file: 'instalacion-android-v1.mp4',              slug: 'instalar-android',   titulo: 'Instalar SGC en Android',           modulo: null,         orden: 1 },
  { file: 'instalacion-iphone-v1.mp4',               slug: 'instalar-iphone',    titulo: 'Instalar SGC en iPhone',            modulo: null,         orden: 2 },
  { file: 'promo-final.mp4',                         slug: 'conoce-sgc',         titulo: 'Conoce SGC (resumen)',              modulo: null,         orden: 0 },
];

function poster(mp4Path, jpgPath) {
  if (existsSync(jpgPath)) return jpgPath;
  try { execFileSync(FFMPEG, ['-y', '-ss', '2', '-i', mp4Path, '-frames:v', '1', '-q:v', '3', jpgPath], { stdio: 'ignore' }); return jpgPath; } catch { return null; }
}

async function subir(localPath, destPath, mime) {
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${destPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.serviceKey}`, apikey: env.serviceKey, 'Content-Type': mime, 'x-upsert': 'true' },
    body: readFileSync(localPath),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  console.log(`\n═══ Videos v2 → ${env.entorno} — ${APPLY ? 'APLICAR' : 'DRY-RUN'} ═══\n`);
  const plan = [];
  for (const v of VIDEOS) {
    const mp4 = resolve(SALIDA, v.file);
    if (!existsSync(mp4)) { console.log(`⚠ falta ${v.file} (render primero) — omito`); continue; }
    const jpg = mp4.replace(/\.mp4$/, '.jpg');
    const rows = await dbQuery(env, `select 1 as x from sgc.ayuda_contenido where tipo='guia' and slug=${Q(v.slug)} limit 1`);
    const existe = Array.isArray(rows) && rows.length > 0;
    plan.push({ ...v, mp4, jpg, existe, destV: `v2/${v.slug}.mp4`, destP: `v2/${v.slug}.jpg` });
    console.log(`• ${v.file} → guía "${v.slug}" (${existe ? 'update (conserva pasos)' : 'insert'})`);
  }
  if (!APPLY) { console.log('\n(DRY-RUN — nada subido. Repite con --apply.)'); return; }

  for (const p of plan) {
    const jpg = poster(p.mp4, p.jpg);
    await subir(p.mp4, p.destV, 'video/mp4');
    if (jpg) await subir(jpg, p.destP, 'image/jpeg');
    // vtt_path:null → los v2 traen subtítulos HORNEADOS; limpia el VTT viejo (CK5) para
    // que no se muestren capítulos desfasados con el video nuevo.
    const patch = { video_path: p.destV, poster_path: jpg ? p.destP : null, vtt_path: null, duracion_s: null, plataforma: 'web', estilo: 'v2' };
    // Idempotente via índice único (tipo, slug): inserta completo si es nuevo; si existe,
    // SOLO agrega los campos de video (conserva titulo/pasos ya escritos).
    const contenido = { id: p.slug, titulo: p.titulo, modulo: p.modulo, icono: p.slug, pasos: [], ...patch };
    await dbQuery(env,
      `insert into sgc.ayuda_contenido (tipo, slug, modulo, orden, activo, solo_admin, contenido)
       values ('guia', ${Q(p.slug)}, ${p.modulo ? Q(p.modulo) : 'null'}, ${p.orden}, true, false, ${Q(JSON.stringify(contenido))}::jsonb)
       on conflict (tipo, slug) do update set contenido = sgc.ayuda_contenido.contenido || ${Q(JSON.stringify(patch))}::jsonb, updated_at = now()`);
    console.log(`✓ ${p.slug} subido + guía ${p.existe ? 'actualizada' : 'creada'}.`);
  }
  console.log('\n✓ Listo.');
}
main().catch((e) => { console.error(e); process.exit(1); });
