import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('gaps dev (assistant_consultas_no_atendidas)', `select id, pregunta, created_at, atendida from sgc.assistant_consultas_no_atendidas order by created_at desc limit 10;`);
await q('cols wa_hallazgos seguimiento', `select id, tipo, estado, seguimiento, seguimiento_desde, creado_en from sgc.wa_hallazgos where seguimiento in ('activo','vencido') limit 10;`);
await q('cols notas (checklist support?)', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='notas' order by ordinal_position;`);
await q('cols nota_compartidos', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='nota_compartidos' order by ordinal_position;`);
await q('destinatarios_notificacion cols', `select column_name,data_type from information_schema.columns where table_schema='sgc' and table_name='destinatarios_notificacion' order by ordinal_position;`);
