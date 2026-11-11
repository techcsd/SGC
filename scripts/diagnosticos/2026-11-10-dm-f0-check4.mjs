import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('gaps dev cols', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='assistant_consultas_no_atendidas' order by ordinal_position;`);
await q('functions %destinatario% or %envio_automatico%', `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sgc' and (p.proname ilike '%destinatario%' or p.proname ilike '%envio_automatico%') order by 1;`);
await q('tables %destinatario% or %envio%', `select table_name from information_schema.tables where table_schema='sgc' and (table_name ilike '%destinatario%' or table_name ilike '%envio%') order by 1;`);
