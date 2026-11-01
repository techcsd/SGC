// scripts/diagnosticos/2026-11-01-db-antipatrones.mjs — SOLO LECTURA (regla 19: diagnóstico = SELECT)
// Antipatrones, redundancias y cuellos de botella del schema `sgc`.
//   doppler run -p amp -c prd -- node scripts/diagnosticos/2026-11-01-db-antipatrones.mjs --env prod --yes
// Salida: qa/db-antipatrones-<env>.md (gitignored).
import '../lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../lib/entorno.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const env = await resolverEnv(process.argv.slice(2));
const q = async (sql) => {
  if (!/^\s*(with|select|show|explain)\b/i.test(sql)) throw new Error('solo lectura');
  try { return await dbQuery(env, sql); } catch (e) { return { error: String(e.message).slice(0, 300) }; }
};
const out = [`# DB antipatrones — ${env.entorno} (${env.ref}) — ${new Date().toISOString()}\n`];
const sec = async (titulo, sql) => {
  out.push(`\n## ${titulo}\n`);
  const rows = await q(sql);
  if (rows.error) return out.push(`_error: ${rows.error}_\n`);
  if (!rows.length) return out.push('_sin filas_\n');
  const cols = Object.keys(rows[0]);
  out.push(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) out.push(`| ${cols.map((c) => String(r[c] ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 160)).join(' | ')} |`);
};

await sec('Resumen', `select (select count(*) from pg_tables where schemaname='sgc') tablas,
  (select count(*) from pg_indexes where schemaname='sgc') indices,
  (select count(*) from pg_policies where schemaname='sgc') politicas_rls,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sgc') funciones,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='sgc' and not t.tgisinternal) triggers,
  pg_size_pretty(pg_database_size(current_database())) tam_db`);

await sec('Top 25 tablas por tamaño (filas vivas, muertas, seq vs idx scans)', `select relname, pg_size_pretty(pg_total_relation_size(relid)) total,
  n_live_tup vivas, n_dead_tup muertas, seq_scan, seq_tup_read, coalesce(idx_scan,0) idx_scan,
  last_autovacuum::date av, last_autoanalyze::date aa
  from pg_stat_user_tables where schemaname='sgc' order by pg_total_relation_size(relid) desc limit 25`);

await sec('Seq scans pesados (tablas >1000 filas, seq_scan > idx_scan)', `select relname, n_live_tup, seq_scan, coalesce(idx_scan,0) idx_scan, seq_tup_read
  from pg_stat_user_tables where schemaname='sgc' and n_live_tup>1000 and seq_scan>coalesce(idx_scan,0)
  order by seq_tup_read desc limit 20`);

await sec('Bloat: muertas > 20% de vivas (>1000 muertas)', `select relname, n_live_tup, n_dead_tup, round(100.0*n_dead_tup/greatest(n_live_tup,1),1) pct
  from pg_stat_user_tables where schemaname='sgc' and n_dead_tup>1000 and n_dead_tup>0.2*n_live_tup order by n_dead_tup desc limit 20`);

await sec('FKs sin índice que las cubra', `select c.conrelid::regclass tabla, c.conname, pg_get_constraintdef(c.oid) def
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace
  where c.contype='f' and n.nspname='sgc' and not exists (
    select 1 from pg_index i where i.indrelid=c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey and i.indisvalid)
  order by pg_total_relation_size(c.conrelid) desc limit 40`);

await sec('Índices sin uso (idx_scan=0, no únicos/PK, >64kB)', `select s.relname tabla, s.indexrelname indice, pg_size_pretty(pg_relation_size(s.indexrelid)) tam, s.idx_scan
  from pg_stat_user_indexes s join pg_index i on i.indexrelid=s.indexrelid
  where s.schemaname='sgc' and s.idx_scan=0 and not i.indisunique and not i.indisprimary and pg_relation_size(s.indexrelid)>65536
  order by pg_relation_size(s.indexrelid) desc limit 30`);

await sec('Índices duplicados (misma tabla, mismas columnas)', `select indrelid::regclass tabla, array_agg(indexrelid::regclass) indices, pg_get_indexdef(min(indexrelid)) def
  from pg_index where indrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sgc')
  group by indrelid, indkey, indpred::text, indexprs::text having count(*)>1`);

await sec('Tablas sin PK', `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='sgc' and c.relkind='r' and not exists (select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p')`);

await sec('Tablas SIN RLS activado', `select c.relname, c.reltuples::bigint filas from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='sgc' and c.relkind='r' and not c.relrowsecurity order by 2 desc`);

await sec('RLS con auth.uid()/auth.jwt() sin envolver en (select …) — initplan perdido', `select tablename, policyname, cmd,
  left(coalesce(qual,'')||' '||coalesce(with_check,''),140) expr
  from pg_policies where schemaname='sgc'
  and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'auth\\.(uid|jwt|role)\\(\\)'
  and (coalesce(qual,'')||coalesce(with_check,'')) !~ '\\( ?SELECT auth\\.' limit 40`);

await sec('Tablas con más políticas RLS (multiple permissive = costo por fila)', `select tablename, cmd, count(*) n from pg_policies
  where schemaname='sgc' and permissive='PERMISSIVE' group by 1,2 having count(*)>3 order by n desc limit 20`);

await sec('Funciones más referenciadas en políticas RLS', `select f[1] funcion, count(*) usos from (
  select regexp_matches(coalesce(qual,'')||' '||coalesce(with_check,''),'(?:sgc\\.)?([a-z_]+)\\(','g') f from pg_policies where schemaname='sgc') x
  where f[1] not in ('select','auth','coalesce','any','array','lower','upper','exists','now') group by 1 order by 2 desc limit 15`);

await sec('Top 20 consultas por tiempo total (pg_stat_statements)', `select left(regexp_replace(query,'\\s+',' ','g'),150) query, calls,
  round(total_exec_time::numeric/1000,1) total_s, round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time::numeric,0) max_ms, rows
  from pg_stat_statements s join pg_roles r on r.oid=s.userid order by total_exec_time desc limit 20`);

await sec('Top 10 consultas por promedio (calls>20)', `select left(regexp_replace(query,'\\s+',' ','g'),150) query, calls,
  round(mean_exec_time::numeric,1) mean_ms, round(max_exec_time::numeric,0) max_ms
  from pg_stat_statements where calls>20 order by mean_exec_time desc limit 10`);

await sec('Cache hit ratio', `select round(100.0*sum(heap_blks_hit)/nullif(sum(heap_blks_hit+heap_blks_read),0),2) tablas_pct,
  (select round(100.0*sum(idx_blks_hit)/nullif(sum(idx_blks_hit+idx_blks_read),0),2) from pg_statio_user_indexes) indices_pct
  from pg_statio_user_tables`);

await sec('Conexiones por estado', `select state, count(*), max(now()-state_change) max_edad from pg_stat_activity where datname=current_database() group by 1`);

await sec('Cron jobs (pg_cron) y fallos recientes', `select j.jobname, j.schedule, left(j.command,80) cmd,
  (select count(*) from cron.job_run_details d where d.jobid=j.jobid and d.status='failed' and d.start_time>now()-interval '7 days') fallos_7d,
  (select round(avg(extract(epoch from d.end_time-d.start_time))::numeric,2) from cron.job_run_details d where d.jobid=j.jobid and d.start_time>now()-interval '7 days') seg_prom
  from cron.job j order by fallos_7d desc, seg_prom desc nulls last limit 30`);

await sec('Triggers por tabla (>3 = escritura cara)', `select c.relname, count(*) triggers from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='sgc' and not t.tgisinternal group by 1 having count(*)>3 order by 2 desc limit 15`);

await sec('Columnas jsonb/text[] grandes sin GIN (candidatas)', `select table_name, column_name, data_type from information_schema.columns
  where table_schema='sgc' and data_type in ('jsonb','ARRAY') order by table_name limit 40`);


mkdirSync('qa', { recursive: true });
const f = `qa/db-antipatrones-${env.entorno}.md`;
writeFileSync(f, out.join('\n'));
console.log('escrito', f, out.length, 'líneas');
