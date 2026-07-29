// Seed sgc.ayuda_contenido desde src/app/pages/dudas/dudas-content.ts (Z30).
// Idempotente: upsert por (tipo, slug). Uso: node scripts/seed-ayuda.mjs
// Lee credenciales de ../dev2/csd-app/.env.local (mismo proyecto Supabase).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const repo = join(__dir, '..');
// Credenciales: reutiliza el .env.local del app (mismo proyecto SGC).
const envPath = join(repo, '..', '..', 'dev2', 'csd-app', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

// Extrae el literal de arreglo que sigue a `export const <name>...= ` por
// emparejamiento de corchetes (robusto a comas finales y comillas simples).
function extractArray(src, name) {
  const anchor = src.indexOf(`export const ${name}`);
  if (anchor < 0) throw new Error(`no encontrado: ${name}`);
  const eq = src.indexOf('=', anchor); // saltar la anotación de tipo (GuiaVisual[])
  const start = src.indexOf('[', eq);
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const literal = src.slice(start, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal};`)();
}

const content = readFileSync(join(repo, 'src/app/pages/dudas/dudas-content.ts'), 'utf8');
const guias = extractArray(content, 'GUIAS_VISUALES');
const categorias = extractArray(content, 'DUDAS_CATEGORIAS');

const rows = [
  ...guias.map((g, i) => ({
    tipo: 'guia', slug: g.id, contenido: g, modulo: g.modulo ?? null, solo_admin: false, orden: i,
  })),
  ...categorias.map((c, i) => ({
    tipo: 'duda_categoria', slug: c.id, contenido: c, modulo: c.modulo ?? null, solo_admin: !!c.soloAdmin, orden: i,
  })),
];

const res = await fetch(`${url}/rest/v1/ayuda_contenido?on_conflict=tipo,slug`, {
  method: 'POST',
  headers: {
    apikey: key, Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json', 'Content-Profile': 'sgc',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify(rows),
});
console.log('seed status', res.status, 'guias', guias.length, 'categorias', categorias.length);
if (!res.ok) console.log(await res.text());
