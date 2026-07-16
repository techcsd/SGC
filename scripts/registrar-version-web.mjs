// Y1 — Registro automático de la versión WEB en el historial, como paso de
// build/deploy (postbuild). No depende de que nadie abra la app.
//
// Llama sgc.registrar_version('web', <version>, <notas>, <titulo>, <cambios>) vía
// PostgREST con la SERVICE ROLE key (solo en el contenedor de build; nunca en el
// cliente). Es idempotente en BD (rellena lo vacío, no sobrescribe).
//
// Requiere en el entorno de build (Vercel → Project Settings → Environment
// Variables): SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Si faltan, el script
// AVISA y termina con éxito (exit 0) para NO romper el build — el auto-registro
// al arrancar la app queda como respaldo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const url = process.env.SUPABASE_URL || process.env.SGC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SGC_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn(
    `[registrar-version-web] SUPABASE_URL/SERVICE_ROLE_KEY no configuradas — se omite el registro de la v${version}. ` +
      `El auto-registro al arrancar la app lo cubrirá. (Configúralas en Vercel para automatizarlo en el deploy.)`,
  );
  process.exit(0);
}

let titulo = null;
let cambios = [];
try {
  const notes = JSON.parse(readFileSync(join(root, 'release-notes.json'), 'utf8'));
  const entry = notes?.web?.[version];
  if (entry) {
    titulo = entry.titulo ?? null;
    cambios = Array.isArray(entry.cambios) ? entry.cambios : [];
  }
} catch {
  /* sin notas: registra solo versión */
}

try {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/registrar_version`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'sgc', // el RPC vive en el schema sgc
    },
    body: JSON.stringify({
      p_plataforma: 'web',
      p_version: version,
      p_notas: null,
      p_titulo: titulo,
      p_cambios: cambios,
    }),
  });
  if (!res.ok) {
    console.warn(`[registrar-version-web] no se pudo registrar v${version} (${res.status}): ${await res.text()}`);
    process.exit(0); // nunca romper el build por el registro
  }
  console.log(`[registrar-version-web] v${version} registrada en el historial (${cambios.length} cambios).`);
} catch (e) {
  console.warn(`[registrar-version-web] error de red al registrar v${version}:`, e?.message ?? e);
  process.exit(0);
}
