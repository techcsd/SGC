import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
for (const fn of ['mis_entregas_por_confirmar', 'mis_firmas_pendientes', 'requisicion_pendiente_items', 'mis_proyectos']) {
  const r = await dbQuery(env, `select pg_get_functiondef(oid) as def from pg_proc where proname='${fn}' and pronamespace='sgc'::regnamespace limit 1;`);
  console.log(`=== ${fn} ===`);
  console.log((r[0]?.def || 'NOT FOUND').slice(0, 1200));
  console.log();
}
