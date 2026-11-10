import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('cols consultas_no_atendidas', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='consultas_no_atendidas' order by ordinal_position;`);
await q('cols wa_hallazgos', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='wa_hallazgos' order by ordinal_position;`);
await q('pendientes consultas_no_atendidas (dev)', `select id, pregunta, created_at, estado from sgc.consultas_no_atendidas order by created_at desc limit 10;`);
await q('wa_hallazgos activos/vencidos (dev)', `select id, created_at from sgc.wa_hallazgos limit 5;`);
await q('claude_borradores cols', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='claude_borradores' order by ordinal_position;`);
await q('envios_automaticos familias existentes', `select distinct familia from sgc.envios_automaticos limit 30;`);
