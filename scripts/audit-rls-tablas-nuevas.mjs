// audit-rls-tablas-nuevas.mjs — BC7 (convención permanente, ver ROLES.md §6.1).
// Detecta tablas de `sgc` con RLS ACTIVA pero SIN camino de escritura para roles
// no-admin: ni política INSERT/UPDATE, ni un RPC SECURITY DEFINER que las alimente.
// Son las candidatas a repetir el patrón AN5/AY6/BC7 ("permission denied for table…").
//
// Uso:  node scripts/audit-rls-tablas-nuevas.mjs
// Necesita SUPABASE_ACCESS_TOKEN. On-demand (no en prebuild: necesita DB).
const PROJECT_REF = 'jeeqhgccqefbqilntcpu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  return JSON.parse(text);
}

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
  process.exit(0);
}
console.log('⚠️  Tablas con RLS activa SIN escritura para no-admin (revisar — patrón BC7):\n');
for (const r of rows) console.log(`   · sgc.${r.tabla}`);
console.log(`\n${rows.length} tabla(s). Cada una necesita: política INSERT/UPDATE por rol, o un RPC SECURITY DEFINER con gate de matriz que la alimente (ver ROLES.md §6.1).`);
console.log('Nota: es heurístico — algunas pueden ser de solo-lectura/append por admin a propósito.');
