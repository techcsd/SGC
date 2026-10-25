// scripts/data-fixes/2026-10-25-cy-resync-folio-seq-dev.mjs — CD10
// Hallazgo lateral de la ronda CY (smoke-cy-conector-fases-3-4-5): en dev,
// sgc.solicitudes_material_folio_seq quedó en 11 mientras la fila demo sembrada
// en CK (folio9001) tiene folio=9001 — el seed insertó esa fila con un folio
// explícito sin avanzar la secuencia. Hoy no revienta nada (11 < 9001), pero
// cualquier requisición real nueva en dev competirá por folios 12,13... hasta
// chocar con 9001 algún día. Dev-only (CD10/regla 18: nunca se toca prod con
// esto — prod no tiene esa fila demo). setval() es seguro/idempotente.
//
//   node scripts/data-fixes/2026-10-25-cy-resync-folio-seq-dev.mjs --env dev --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') {
  console.error('🔴 Este data-fix es SOLO para dev (la fila demo folio9001 no existe en prod).');
  process.exit(1);
}

const antes = await dbQuery(env, `select (select max(folio) from sgc.solicitudes_material) as max_folio, (select last_value from sgc.solicitudes_material_folio_seq) as seq_antes`);
await dbQuery(env, `select setval('sgc.solicitudes_material_folio_seq', (select max(folio) from sgc.solicitudes_material))`);
const despues = await dbQuery(env, `select last_value as seq_despues from sgc.solicitudes_material_folio_seq`);

console.log('Antes:', JSON.stringify(antes));
console.log('Después:', JSON.stringify(despues));
console.log('✓ secuencia de folio de solicitudes_material resincronizada en dev.');
