// audit-kpis-es-prueba.mjs — DS-41 (#64). Auditoria automatica (SOLO LECTURA) de
// RPC/vistas del esquema sgc que AGREGAN (count/sum/avg) sobre tablas con
// columna `es_prueba` y NO la filtran en ninguna parte de su definicion: ahi un
// KPI mezcla datos de prueba con operacion real (p.ej. el 100% de los
// incidentes de bitacora en prod eran de prueba).
//
// Uso:  node scripts/audit-kpis-es-prueba.mjs --env dev [--report]
// Sale con codigo 1 si aparece algo NUEVO fuera de scripts/audit-kpis-es-prueba.baseline.json.
// El baseline lista lo ya revisado a mano (con el motivo). Diagnostico: solo SELECT.
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { consulta } from './lib/dbq-dev.mjs';
import { readFileSync, existsSync } from 'node:fs';

const REPORT = process.argv.includes('--report');
const env = await resolverEnv(process.argv.slice(2));
const base = existsSync('scripts/audit-kpis-es-prueba.baseline.json')
  ? JSON.parse(readFileSync('scripts/audit-kpis-es-prueba.baseline.json', 'utf8')) : { revisados: {} };

// Tablas "catalogo/maestro" que solo se usan para resolver nombres: no cuentan como fuente del KPI.
const MAESTRAS = ['usuarios', 'bodegas', 'articulos', 'proveedores', 'empleados', 'proveedores_transporte'];

const sql = `
with t as (
  select table_name from information_schema.columns
   where table_schema='sgc' and column_name='es_prueba'
     and table_name not in (${MAESTRAS.map((m) => `'${m}'`).join(',')})
     and table_name in (select table_name from information_schema.tables where table_schema='sgc' and table_type='BASE TABLE')
), f as (
  select 'funcion'::text tipo, p.proname::text nombre, pg_get_functiondef(p.oid) d
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='sgc' and p.prokind='f' and p.prorettype <> 'trigger'::regtype
  union all
  select 'vista', c.relname::text, pg_get_viewdef(c.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='sgc' and c.relkind in ('v','m')
)
select f.tipo, f.nombre, string_agg(distinct t.table_name, ',' order by t.table_name) tablas
  from f join t on f.d ~* ('(from|join)\\s+(sgc\\.)?' || t.table_name || '\\M')
 where f.d !~* 'es_prueba'
   and f.d ~* '\\m(count|sum|avg)\\s*\\('
 group by 1,2 order by 1,2`;

const filas = await consulta(env, sql);
const nuevos = filas.filter((f) => !base.revisados[`${f.tipo}:${f.nombre}`]);
const ok = filas.length - nuevos.length;

console.log(`audit-kpis-es-prueba (${env.entorno}): ${filas.length} candidatos, ${ok} revisados en baseline, ${nuevos.length} nuevos.`);
for (const f of nuevos) console.log(`  [NUEVO] ${f.tipo} sgc.${f.nombre}  ← ${f.tablas}`);
if (REPORT) for (const f of filas.filter((x) => base.revisados[`${x.tipo}:${x.nombre}`]))
  console.log(`  [ok] ${f.tipo} sgc.${f.nombre} — ${base.revisados[`${f.tipo}:${f.nombre}`]}`);
if (nuevos.length && !REPORT) {
  console.error('\nAgrega es_prueba al filtro (o, si es legitimo, anotalo en el baseline con el motivo).');
  process.exit(1);
}
