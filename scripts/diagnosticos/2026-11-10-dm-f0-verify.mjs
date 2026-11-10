import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('validar_km_vehiculo firmas (prod, post-fix)', `select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sgc' and p.proname='validar_km_vehiculo';`);
await q('app_error_estados check constraint (regla_negocio permitido?)', `select pg_get_constraintdef(oid) from pg_constraint where conname='app_error_estados_estado_check';`);
