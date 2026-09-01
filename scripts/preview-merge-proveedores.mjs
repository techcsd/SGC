// preview-merge-proveedores.mjs — BF2 (AM8: lista previa a Xaviel ANTES de fusionar).
// Muestra cómo se fusionaría sgc.proveedores_transporte → sgc.proveedores:
// cada transportista se EMPAREJA con un proveedor existente (por nombre/RNC) o se
// INSERTA nuevo, tageado 'transportista'. NO modifica nada — solo imprime el plan.
//
// Uso:  node scripts/preview-merge-proveedores.mjs
// Lee credenciales de ../dev2/csd-app/.env.local (mismo proyecto Supabase).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '..', '..', 'dev2', 'csd-app', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  }),
);
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY en csd-app/.env.local'); process.exit(1); }

async function q(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'sgc' },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const norm = (s) => (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const digits = (s) => (s ?? '').toString().replace(/\D/g, '');

const [transp, provs] = await Promise.all([
  q('proveedores_transporte?select=id,nombre,rnc,telefono,estado,activo,es_prueba&order=nombre'),
  q('proveedores?select=id,nombre,rnc,tipos&order=nombre'),
]);

const byNombre = new Map(), byRnc = new Map();
for (const p of provs) {
  byNombre.set(norm(p.nombre), p);
  if (p.rnc) byRnc.set(digits(p.rnc), p);
}

let match = 0, nuevos = 0;
console.log(`\n=== BF2 — Plan de fusión proveedores_transporte (${transp.length}) → proveedores ===\n`);
for (const t of transp) {
  const m = byNombre.get(norm(t.nombre)) ?? (t.rnc ? byRnc.get(digits(t.rnc)) : null);
  if (m) {
    match++;
    const yaTransp = (m.tipos ?? []).includes('transportista');
    console.log(`  EMPAREJA  "${t.nombre}"  →  proveedor "${m.nombre}" (${m.id})${yaTransp ? ' [ya transportista]' : ' [+ tipo transportista]'}`);
  } else {
    nuevos++;
    console.log(`  NUEVO     "${t.nombre}"  →  insertar como proveedor (tipos=[transportista])${t.es_prueba ? ' [PRUEBA]' : ''}`);
  }
}
console.log(`\nResumen: ${match} emparejan con un proveedor existente · ${nuevos} se insertan nuevos.`);
console.log('Revisa esta lista con Xaviel ANTES de aplicar sql/2026-09-01-bf2b-merge-transporte-HELD.sql.\n');
