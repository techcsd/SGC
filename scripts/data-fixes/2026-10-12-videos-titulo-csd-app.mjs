// scripts/data-fixes/2026-10-12-videos-titulo-csd-app.mjs  (regla 18/19/CD10)
// Corrige el TÍTULO de los videos de instalación en Dudas: lo que se instala es la
// **CSD App** (móvil), no el SGC (web). El script de subida conserva el título existente
// en updates, por eso hay que corregirlo aquí.
//
//   node scripts/data-fixes/2026-10-12-videos-titulo-csd-app.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-12-videos-titulo-csd-app.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-12-videos-titulo-csd-app.mjs --env prod --apply --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

const FIX = [
  { slug: 'instalar-android', titulo: 'Instalar la CSD App en Android' },
  { slug: 'instalar-iphone', titulo: 'Instalar la CSD App en iPhone' },
  // La guía `requisicion` tiene el video de CREAR una requisición, pero quedó con un
  // título heredado ("Aprobar y despachar…") igual al de `aprobar-despachar` → se corrige.
  { slug: 'requisicion', titulo: 'Crear una requisición' },
];

for (const f of FIX) {
  const [antes] = await dbQuery(env, `select contenido->>'titulo' t from sgc.ayuda_contenido where slug='${f.slug}'`);
  console.log(`(${env.entorno}) ${f.slug}: "${antes?.t ?? '—'}" → "${f.titulo}"`);
  if (APPLY) {
    await dbQuery(env, `update sgc.ayuda_contenido set contenido = jsonb_set(contenido, '{titulo}', '"${f.titulo}"'::jsonb), updated_at = now() where slug='${f.slug}'`);
  }
}
console.log(APPLY ? '\n✅ títulos corregidos.' : '\n(dry-run) usa --apply.');
