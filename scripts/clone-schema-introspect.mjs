// clone-schema-introspect.mjs — BU1 F1.2 — clona el ESQUEMA de prod a dev usando
// introspección vía Management API (read-only en prod: solo lee catálogos con las
// funciones nativas pg_get_*def / format_type / pg_get_expr para fidelidad exacta).
// Aplica a dev en orden de dependencias, troceado bajo el límite de ~1 MB del
// endpoint, con fallback statement-a-statement si un lote falla. Idempotente
// (create if not exists / or replace; errores "already exists" se ignoran).
//
// Uso:   node scripts/clone-schema-introspect.mjs
// Env:   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF_DEV
//
// NO toca prod. Esquemas de app: sgc, wa_agent, + public.n8n_* (memoria n8n).
import './lib/load-env.mjs';
import { writeFileSync } from 'node:fs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROD = 'jeeqhgccqefbqilntcpu';
const DEV = process.env.SUPABASE_PROJECT_REF_DEV;
if (!TOKEN || !DEV) { console.error('faltan SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF_DEV'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(ref, sql) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 6) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) { const e = new Error(text); e.http = res.status; throw e; }
    return JSON.parse(text);
  }
}
// Lee un array de DDL (queries que hacen `select ... as data`).
async function emit(sql) {
  const rows = await query(PROD, sql);
  return (rows[0] && rows[0].data) || [];
}

// Filtro de relaciones de app (c = pg_class alias, n = pg_namespace alias).
const REL = (c, n) => `(${n}.nspname in ('sgc','wa_agent') or (${n}.nspname='public' and ${c}.relname like 'n8n%'))`;

const Q = {
  schemas: `select json_agg(x) as data from (values ('create schema if not exists sgc;'),('create schema if not exists wa_agent;')) v(x)`,

  types: `select coalesce(json_agg(format('create type %I.%I as enum (%s);', n.nspname, t.typname,
      (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) order by t.typname),'[]') as data
    from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname in ('sgc','wa_agent') and t.typtype='e'`,

  seqs: `select coalesce(json_agg(format('create sequence if not exists %I.%I as %s;', sequence_schema, sequence_name, data_type)),'[]') as data
    from information_schema.sequences
    where sequence_schema in ('sgc','wa_agent') or (sequence_schema='public' and sequence_name like 'n8n%')`,

  tables: `select coalesce(json_agg(ddl order by ord),'[]') as data from (
      select n.nspname||'.'||c.relname as ord,
        format('create table if not exists %I.%I (%s);', n.nspname, c.relname,
          string_agg(
            format('%I %s%s%s%s%s',
              a.attname,
              format_type(a.atttypid, a.atttypmod),
              case when a.attnotnull then ' not null' else '' end,
              case when a.attidentity in ('a','d') then ' generated '||case a.attidentity when 'a' then 'always' else 'by default' end||' as identity' else '' end,
              case when a.attgenerated='s' then ' generated always as ('||pg_get_expr(ad.adbin, ad.adrelid)||') stored' else '' end,
              case when ad.adbin is not null and a.attgenerated='' and a.attidentity='' then ' default '||pg_get_expr(ad.adbin, ad.adrelid) else '' end
            ), ', ' order by a.attnum)
        ) as ddl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum
      where c.relkind='r' and ${REL('c','n')}
      group by n.nspname, c.relname
    ) t`,

  consNoFk: `select coalesce(json_agg(format('alter table %s add constraint %I %s;', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text),'[]') as data
    from pg_constraint c
    join pg_class tc on tc.oid=c.conrelid join pg_namespace tn on tn.oid=tc.relnamespace
    where c.contype in ('p','u','c') and c.conrelid<>0 and ${REL('tc','tn')}`,

  consFk: `select coalesce(json_agg(format('alter table %s add constraint %I %s;', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text),'[]') as data
    from pg_constraint c
    join pg_class tc on tc.oid=c.conrelid join pg_namespace tn on tn.oid=tc.relnamespace
    where c.contype='f' and ${REL('tc','tn')}`,

  indexes: `select coalesce(json_agg(pi.indexdef||';' order by pi.indexname),'[]') as data
    from pg_indexes pi
    join pg_class ic on ic.relname=pi.indexname
    join pg_namespace ins on ins.oid=ic.relnamespace and ins.nspname=pi.schemaname
    where (pi.schemaname in ('sgc','wa_agent') or (pi.schemaname='public' and pi.tablename like 'n8n%'))
      and not exists (select 1 from pg_constraint con where con.conindid=ic.oid)`,

  functions: `select coalesce(json_agg(pg_get_functiondef(p.oid)||';' order by p.oid),'[]') as data
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('sgc','wa_agent') and p.prokind='f'`,

  views: `select coalesce(json_agg(format('create or replace view %I.%I as %s;', n.nspname, c.relname, pg_get_viewdef(c.oid)) order by c.oid),'[]') as data
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='v' and n.nspname in ('sgc','wa_agent')`,

  triggers: `select coalesce(json_agg(pg_get_triggerdef(t.oid)||';' order by t.oid),'[]') as data
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and (
      n.nspname in ('sgc','wa_agent')
      or (n.nspname='public' and c.relname like 'n8n%')
      or (n.nspname='auth' and c.relname='users' and exists (
            select 1 from pg_proc p join pg_namespace pn on pn.oid=p.pronamespace
            where p.oid=t.tgfoid and pn.nspname in ('sgc','wa_agent','public'))))`,

  rls: `select coalesce(json_agg(format('alter table %I.%I enable row level security;', n.nspname, c.relname)
        || case when c.relforcerowsecurity then format(' alter table %I.%I force row level security;', n.nspname, c.relname) else '' end),'[]') as data
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and c.relrowsecurity and ${REL('c','n')}`,

  policies: `select coalesce(json_agg(ddl order by ord),'[]') as data from (
      select pc.oid as ord, format(
        'create policy %I on %s%s for %s to %s%s%s;',
        pol.polname, pol.polrelid::regclass,
        case when pol.polpermissive then '' else ' as restrictive' end,
        case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
        coalesce((select string_agg(case when pr.oid=0 then 'public' else quote_ident(r.rolname) end, ', ')
                  from unnest(pol.polroles) pr(oid) left join pg_roles r on r.oid=pr.oid), 'public'),
        case when pol.polqual is not null then ' using ('||pg_get_expr(pol.polqual, pol.polrelid)||')' else '' end,
        case when pol.polwithcheck is not null then ' with check ('||pg_get_expr(pol.polwithcheck, pol.polrelid)||')' else '' end
      ) as ddl
      from pg_policy pol join pg_class pc on pc.oid=pol.polrelid join pg_namespace n on n.oid=pc.relnamespace
      where ${REL('pc','n')} or n.nspname='storage'
    ) t`,

  grantsSchema: `select json_agg(x) as data from (values
      ('grant usage on schema sgc to anon, authenticated, service_role;'),
      ('grant usage on schema wa_agent to anon, authenticated, service_role;')) v(x)`,

  grantsObj: `select coalesce(json_agg(distinct format('grant %s on %s to %I;', ae.privilege_type, c.oid::regclass, r.rolname)),'[]') as data
    from pg_class c join pg_namespace n on n.oid=c.relnamespace,
    lateral aclexplode(c.relacl) ae join pg_roles r on r.oid=ae.grantee
    where c.relkind in ('r','v','S') and r.rolname in ('anon','authenticated','service_role') and ${REL('c','n')}`,

  grantsFn: `select coalesce(json_agg(distinct format('grant execute on function %s to %I;', p.oid::regprocedure, r.rolname)),'[]') as data
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(p.proacl) ae join pg_roles r on r.oid=ae.grantee
    where n.nspname in ('sgc','wa_agent') and ae.privilege_type='EXECUTE' and r.rolname in ('anon','authenticated','service_role')`,

  buckets: `select coalesce(json_agg(json_build_object('id',id,'name',name,'public',public,'fsl',file_size_limit,'mimes',allowed_mime_types)),'[]') as data from storage.buckets`,
};

// ── aplicar a dev, troceado + fallback statement-a-statement ─────────────────
const MAX_BYTES = 400_000, MAX_STMTS = 60;
const failures = [];

async function applyOne(stmt) {
  try { await query(DEV, stmt); return true; }
  catch (e) {
    if (/already exists|multiple primary keys|is a duplicate/i.test(String(e.message))) return true; // idempotente
    failures.push({ stmt, err: String(e.message).slice(0, 300) });
    return false;
  }
}
async function applyPhase(name, statements, { prefix = '' } = {}) {
  if (!statements.length && !prefix) { console.log(`  ${name}: 0`); return; }
  let ok = 0, chunk = [], bytes = prefix.length;
  const flush = async () => {
    if (!chunk.length) return;
    const sql = (prefix ? prefix + '\n' : '') + chunk.join('\n');
    try { await query(DEV, sql); ok += chunk.length; }
    catch { for (const s of chunk) if (await applyOne((prefix ? prefix + '\n' : '') + s)) ok++; }
    chunk = []; bytes = prefix.length;
  };
  for (const s of statements) {
    if (chunk.length >= MAX_STMTS || bytes + s.length > MAX_BYTES) await flush();
    chunk.push(s); bytes += s.length + 1;
  }
  await flush();
  console.log(`  ${name}: ${ok}/${statements.length}`);
}

console.log('▶ clonando esquema prod → dev (introspección)\n');

const [schemas, types, seqs, tables, consNoFk, consFk, indexes, functions, views, triggers, rls, policies, grantsSchema, grantsObj, grantsFn, buckets] =
  await Promise.all(Object.values(Q).map((sql) => emit(sql)));

await applyPhase('schemas', schemas);
await applyPhase('grants-schema', grantsSchema);
await applyPhase('types (enums)', types);
await applyPhase('sequences', seqs);
await applyPhase('tables', tables);
await applyPhase('constraints (pk/uq/chk)', consNoFk);
await applyPhase('constraints (fk)', consFk);
await applyPhase('indexes', indexes);
await applyPhase('functions', functions, { prefix: 'set check_function_bodies = off;' });
// vistas: pueden depender entre sí → reintenta hasta que no avance.
let pending = views;
for (let pass = 0; pass < 4 && pending.length; pass++) {
  const before = failures.length; const still = [];
  for (const v of pending) { if (!(await applyOne(v))) still.push(v); }
  failures.length = before; // no acumular fallos de vistas hasta el último pase
  if (still.length === pending.length) { for (const v of still) await applyOne(v); break; }
  pending = still;
}
console.log(`  views: ${views.length - pending.length}/${views.length}`);
await applyPhase('triggers', triggers);
await applyPhase('rls-enable', rls);
await applyPhase('policies', policies);
await applyPhase('grants-obj', grantsObj);
await applyPhase('grants-fn', grantsFn);

// buckets vía insert (upsert)
const bstmts = buckets.map((b) => {
  const mimes = b.mimes ? 'array[' + b.mimes.map((m) => `'${m}'`).join(',') + ']' : 'null';
  const fsl = b.fsl == null ? 'null' : b.fsl;
  return `insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('${b.id}','${b.name}',${b.public},${fsl},${mimes}) on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;`;
});
await applyPhase('buckets', bstmts);

// Reintento final de fallos (ordenamiento cruzado tablas/funciones).
if (failures.length) {
  console.log(`\n↻ reintentando ${failures.length} statement(s) fallidos…`);
  const retry = [...failures]; failures.length = 0;
  for (const f of retry) await applyOne(f.stmt);
}

if (failures.length) {
  writeFileSync('scratchpad/clone-errors.log', failures.map((f) => `-- ${f.err}\n${f.stmt.slice(0, 600)}`).join('\n\n'));
  console.log(`\n⚠️ ${failures.length} fallo(s) → scratchpad/clone-errors.log`);
} else {
  console.log('\n✓ aplicado sin fallos');
}
