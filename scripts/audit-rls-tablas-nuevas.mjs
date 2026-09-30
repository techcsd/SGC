// audit-rls-tablas-nuevas.mjs — BC7 (convención permanente, ver ROLES.md §6.1).
// Detecta tablas de `sgc` con RLS ACTIVA pero SIN camino de escritura para roles
// no-admin: ni política INSERT/UPDATE, ni un RPC SECURITY DEFINER que las alimente.
// Son las candidatas a repetir el patrón AN5/AY6/BC7 ("permission denied for table…").
//
// Uso:  node scripts/audit-rls-tablas-nuevas.mjs --env dev|prod
// Necesita SUPABASE_ACCESS_TOKEN. On-demand (no en prebuild: necesita DB).
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));
const q = (sql) => dbQuery(env, sql);
console.log(`Auditoría RLS/GRANT — entorno ${env.entorno} (${env.ref})\n`);

// (1) Tablas con RLS activa SIN política de escritura no-admin (rápido).
const tablas = await q(`
  with t as (
    select c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='sgc' and c.relkind='r' and c.relrowsecurity
  ),
  write_pol as (
    select tablename, bool_or(
      cmd in ('INSERT','UPDATE','ALL')
      and coalesce(with_check,qual,'') !~* 'is_admin'      -- excluye políticas admin-only
    ) as has_nonadmin_write
    from pg_policies where schemaname='sgc' group by tablename
  )
  select t.relname as tabla
  from t left join write_pol wp on wp.tablename=t.relname
  where coalesce(wp.has_nonadmin_write,false)=false
  order by t.relname;
`);

// (2) Cuerpos de TODAS las funciones SECURITY DEFINER de sgc, una sola vez.
const defs = await q(`
  select lower(pg_get_functiondef(p.oid)) as def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='sgc' and p.prosecdef;
`);
const definerBlob = defs.map((d) => d.def).join('\n');
// Una tabla está "cubierta por definer" si algún cuerpo la inserta/actualiza.
const cubiertaPorDefiner = (tabla) => {
  const t = tabla.toLowerCase();
  return new RegExp(`(insert\\s+into|update)\\s+(sgc\\.)?${t}\\b`).test(definerBlob);
};

const rows = tablas
  .map((r) => r.tabla)
  .filter((t) => !cubiertaPorDefiner(t))
  .map((t) => ({ tabla: t }));

if (!rows.length) {
  console.log('✓ Ninguna tabla con RLS activa quedó sin camino de escritura (política no-admin o RPC SECURITY DEFINER).');
} else {
  console.log('⚠️  Tablas con RLS activa SIN escritura para no-admin (revisar — patrón BC7):\n');
  for (const r of rows) console.log(`   · sgc.${r.tabla}`);
  console.log(`\n${rows.length} tabla(s). Cada una necesita: política INSERT/UPDATE por rol, o un RPC SECURITY DEFINER con gate de matriz que la alimente (ver ROLES.md §6.1).`);
  console.log('Nota: es heurístico — algunas pueden ser de solo-lectura/append por admin a propósito.');
}

// ── CC8 — Auditoría de GRANT del esquema ─────────────────────────────────────
// El bug CC8 (permission denied for table bitacora_orden_detalle) fue una
// política `to authenticated FOR select` SIN su `grant select`. Postgres revisa
// el GRANT antes que la RLS → 403 en silencio para todo usuario. Esta auditoría
// es la RED AUTORITATIVA (consulta el catálogo vivo): por cada tabla sgc.* con
// RLS y una política que apunta a `authenticated`/`public`, verifica que el rol
// `authenticated` tenga el privilegio del COMANDO de esa política. Lo que falte
// es un gap real → se concede en la migración de grants (ver
// sql/2026-09-29-cc8-grants-orden-trabajo.sql).
console.log('\n── Auditoría de GRANT (política to authenticated ⇒ grant del comando) ──');
const grantGaps = await q(`
  with pol as (
    select p.tablename,
           unnest(case p.cmd
             when 'ALL' then array['select','insert','update','delete']
             when 'SELECT' then array['select'] when 'INSERT' then array['insert']
             when 'UPDATE' then array['update'] when 'DELETE' then array['delete']
           end) as priv
    from pg_policies p
    where p.schemaname='sgc'
      and (p.roles @> array['authenticated']::name[] or p.roles @> array['public']::name[])
  ),
  rls as (
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='sgc' and c.relkind='r' and c.relrowsecurity
  ),
  needs as (select distinct pol.tablename, pol.priv from pol join rls on rls.relname=pol.tablename)
  select tablename, priv from needs
  where not has_table_privilege('authenticated','sgc.'||tablename, priv)
  order by tablename, priv;
`);
if (!grantGaps.length) {
  console.log('✓ Toda política `to authenticated` tiene el GRANT de su comando (sin gaps de GRANT).');
} else {
  const byT = {};
  for (const g of grantGaps) (byT[g.tablename] = byT[g.tablename] || []).push(g.priv);
  console.log(`\n🔴 ${grantGaps.length} GAP(s) de GRANT — política declara acceso a authenticated pero falta el privilegio (patrón CC8):\n`);
  for (const t of Object.keys(byT)) console.log(`   · sgc.${t} → grant ${byT[t].join(', ')} to authenticated;`);
  console.log('\nCada uno es un 403 latente. Concédelos en una migración (la RLS sigue filtrando).');
  process.exit(1);
}

