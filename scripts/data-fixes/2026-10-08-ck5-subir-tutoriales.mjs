// scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs — CK5 (regla 18/19)
// Sube los videos grabados en tutoriales/salida/ al bucket privado `tutoriales` y escribe
// los campos de video (video_path/poster_path/vtt_path/duracion_s/plataforma/version) en
// la guía correspondiente de sgc.ayuda_contenido (contenido jsonb).
//
//   node scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-08-ck5-subir-tutoriales.mjs --env prod --apply    (tras OK de Xaviel por cada video)
//
// DRY-RUN por defecto (regla 19). A prod SOLO después de que Xaviel vea cada video (docs/TUTORIALES.md).
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');
if (!env.serviceKey) {
  console.error(`🔴 Falta SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()} en .env.local`);
  process.exit(1);
}

const BUCKET = 'tutoriales';
const SALIDA = resolve('tutoriales', 'salida');

// Mapeo guion → id de guía en ayuda_contenido (contenido->>'id'). Si una guía no existe
// aún, el script lo reporta (hay que sembrarla en sql/2026-10-08-ck5-tutoriales.sql).
const MAP = {
  'web-apoyo-transporte': 'apoyo-transporte',
  'web-crear-conduce': 'conduce',
  'web-aprobar-requisicion': 'requisicion',
  'web-conduce-externo': 'conduce-externo',
  'web-transferir-conduce': 'transferir-conduce',
  'web-registrar-mantenimiento': 'mantenimiento',
  'web-autorizar-chofer-privado': 'chofer-privado',
  'web-mis-choferes': 'mis-choferes',
};

const MIME = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.vtt': 'text/vtt' };

// Busca el .mp4 más reciente por guion (acepta sufijo -v{n}).
function recolectar() {
  if (!existsSync(SALIDA)) { console.error(`🔴 No existe ${SALIDA}. Graba primero (tutoriales/).`); process.exit(1); }
  const files = readdirSync(SALIDA).filter((f) => f.endsWith('.mp4'));
  const items = [];
  for (const mp4 of files) {
    const m = mp4.match(/^(.+?)-v(\d+)\.mp4$/);
    if (!m) continue;
    const [, id, version] = m;
    const base = `${id}-v${version}`;
    const poster = `${base}.jpg`, vtt = `${base}.vtt`;
    items.push({
      guion: id, version: Number(version),
      mp4: resolve(SALIDA, mp4),
      poster: existsSync(resolve(SALIDA, poster)) ? resolve(SALIDA, poster) : null,
      vtt: existsSync(resolve(SALIDA, vtt)) ? resolve(SALIDA, vtt) : null,
    });
  }
  // Conserva solo la mayor versión por guion.
  const porGuion = new Map();
  for (const it of items) {
    const prev = porGuion.get(it.guion);
    if (!prev || it.version > prev.version) porGuion.set(it.guion, it);
  }
  return [...porGuion.values()];
}

async function subir(localPath, destPath) {
  const ext = destPath.slice(destPath.lastIndexOf('.'));
  const res = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${destPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: readFileSync(localPath),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const Q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
  const items = recolectar();
  if (!items.length) { console.error('No hay videos en tutoriales/salida/ (*.mp4 con sufijo -v{n}).'); process.exit(1); }

  console.log(`\n═══ CK5 subir tutoriales — ${env.entorno} — ${APPLY ? 'APLICAR' : 'DRY-RUN'} ═══\n`);
  const plan = [];
  for (const it of items) {
    const guiaId = MAP[it.guion];
    if (!guiaId) { console.log(`⚠ ${it.guion}: sin mapeo a guía → agrégalo a MAP[]`); continue; }
    // ¿Existe la guía en ayuda_contenido?
    const rows = await dbQuery(env, `select 1 from sgc.ayuda_contenido where tipo='guia' and contenido->>'id'=${Q(guiaId)} limit 1`);
    const existe = Array.isArray(rows) && rows.length > 0;
    const dur = it.vtt ? estimarDuracion(it.vtt) : null;
    const dest = {
      video: `${it.guion}/v${it.version}.mp4`,
      poster: it.poster ? `${it.guion}/v${it.version}.jpg` : null,
      vtt: it.vtt ? `${it.guion}/v${it.version}.vtt` : null,
    };
    plan.push({ ...it, guiaId, existe, dur, dest });
    console.log(`• ${it.guion} → guía "${guiaId}" ${existe ? '✓' : '🔴 NO EXISTE (sembrar guía primero)'}`);
    console.log(`    subir: ${dest.video}${dest.poster ? ', ' + dest.poster : ''}${dest.vtt ? ', ' + dest.vtt : ''}  (${dur ?? '?'}s)`);
  }

  if (!APPLY) {
    console.log('\n(DRY-RUN — nada subido. Repite con --apply cuando Xaviel haya visto cada video.)');
    return;
  }

  for (const p of plan) {
    if (!p.existe) { console.log(`✗ ${p.guion}: guía "${p.guiaId}" no existe; omitido.`); continue; }
    await subir(p.mp4, p.dest.video);
    if (p.dest.poster) await subir(p.poster, p.dest.poster);
    if (p.dest.vtt) await subir(p.vtt, p.dest.vtt);
    // Escribe los campos de video dentro del contenido jsonb de la guía.
    const patch = {
      video_path: p.dest.video,
      poster_path: p.dest.poster,
      vtt_path: p.dest.vtt,
      duracion_s: p.dur,
      plataforma: p.guion.startsWith('app-') ? 'app' : 'web',
    };
    await dbQuery(env,
      `update sgc.ayuda_contenido set contenido = contenido || ${Q(JSON.stringify(patch))}::jsonb
       where tipo='guia' and contenido->>'id'=${Q(p.guiaId)}`);
    console.log(`✓ ${p.guion} subido + guía "${p.guiaId}" actualizada.`);
  }
  console.log('\n✓ Listo.');
}

// Duración ≈ último timestamp "fin" del VTT (+ cierre).
function estimarDuracion(vttPath) {
  const t = readFileSync(vttPath, 'utf8');
  let ult = 0;
  for (const m of t.matchAll(/-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g)) {
    const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    if (s > ult) ult = s;
  }
  return Math.ceil(ult + 2.2);
}

main().catch((e) => { console.error(e); process.exit(1); });
