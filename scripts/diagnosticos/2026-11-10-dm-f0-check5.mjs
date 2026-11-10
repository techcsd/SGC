import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
async function q(titulo, sql) {
  console.log(`\n== ${titulo} ==`);
  try { console.table(await dbQuery(env, sql)); } catch (e) { console.log(`(error) ${e.message}`); }
}
await q('38 firmas reales (raw, sin RPC)', `
  with g as (
    select sgc.error_firma(r.message) as firma,
      (array_agg(r.error_type order by r.created_at desc))[1] as error_type,
      count(*) as ocurrencias, count(distinct r.usuario_id) as usuarios,
      min(r.created_at) as primera_vez, max(r.created_at) as ultima_vez
    from sgc.app_error_reports r group by 1
  )
  select g.*, coalesce(e.estado,'abierto') as estado
  from g left join sgc.app_error_estados e on e.firma = g.firma
  where coalesce(e.estado,'abierto') not in ('solucionado','regla_negocio')
  order by g.ocurrencias desc limit 60;`);
await q('cols app_error_reports (prod, confirmar usuario_id vs user_id)', `select column_name from information_schema.columns where table_schema='sgc' and table_name='app_error_reports' order by ordinal_position;`);
await q('consultas_no_atendidas pendientes (prod)', `select count(*) total, count(*) filter (where resuelto) resueltos from sgc.assistant_consultas_no_atendidas;`);
await q('wa_hallazgos activo/vencido (prod)', `select estado, seguimiento, count(*) from sgc.wa_hallazgos where seguimiento in ('activo','vencido') group by 1,2;`);
