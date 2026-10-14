// scripts/data-fixes/2026-10-14-co8-aprobador-eduardo.mjs — PROMPT-98 F12 (CO8)
// Fija el parámetro `compras_tec_aprobador` = Eduardo Ng (default elegido, regla A).
//
//   node scripts/data-fixes/2026-10-14-co8-aprobador-eduardo.mjs --env dev            (DRY-RUN)
//   node scripts/data-fixes/2026-10-14-co8-aprobador-eduardo.mjs --env dev --apply
//   node scripts/data-fixes/2026-10-14-co8-aprobador-eduardo.mjs --env prod --apply --yes
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const APPLY = process.argv.includes('--apply');

const candidatos = await dbQuery(env, `
  select id, nombre, cedula from sgc.usuarios where nombre ilike '%eduardo%ng%' or nombre ilike '%eduardo ng%'`);

if (candidatos.length !== 1) {
  console.error(`🔴 Se esperaba exactamente 1 "Eduardo Ng", se encontraron ${candidatos.length}:`);
  console.error(candidatos.map((c) => `  ${c.id}  ${c.nombre}`).join('\n'));
  process.exit(1);
}
const eduardo = candidatos[0];
console.log(`Candidato único: ${eduardo.nombre} (${eduardo.id})`);

const [actual] = await dbQuery(env, `select valor from sgc.parametros where clave = 'compras_tec_aprobador'`);
console.log(`Valor actual: ${actual?.valor || '(vacío)'}`);

if (APPLY) {
  await dbQuery(env, `update sgc.parametros set valor = '${eduardo.id}' where clave = 'compras_tec_aprobador'`);
  console.log('✅ aprobador fijado.');
} else {
  console.log('(dry-run) usa --apply para fijar.');
}
