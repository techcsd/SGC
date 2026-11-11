import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('config sembrada', `select usuario_id, modo, activo from sgc.agente_pendientes_config;`);
await q('permisos Xaviel', `select * from sgc.agente_pendientes_permisos('4b19cc4b-3dbe-40dc-8631-ef489cad0f45');`);
await q('familia envios_automaticos', `select familia, activo from sgc.envios_automaticos where familia='agente_pendientes';`);
await q('crons registrados', `select jobname, schedule from cron.job where jobname like 'agente-pendientes%';`);
