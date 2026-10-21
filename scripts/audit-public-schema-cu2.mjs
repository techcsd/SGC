// audit-public-schema-cu2.mjs — CU2 (fila 269, prioridad máxima; ver
// sql/2026-10-20-cu2-public-default-privileges.sql y docs/SEGURIDAD.md).
// El SGC vive ENTERO en el esquema `sgc`. `public` está en el db_schema expuesto
// por el Data API junto a `sgc` (confirmado por la Management API, dev y prod) —
// cualquier tabla ahí sin RLS, o con RLS pero con GRANT directo a anon/authenticated
// sin ninguna política, queda alcanzable por la API REST tal cual pasó con
// `n8n_chat_histories` (CT9/CU2). Este es el GATE que falla release-check si eso
// se repite. Deliberadamente SEPARADO de `audit-rls-tablas-nuevas.mjs` (que audita
// `sgc` y tiene deuda preexistente sin relación con esto — ver su propia salida)
// para que un gap viejo de `sgc` no bloquee el gate de seguridad de `public`.
// `web` es el esquema de otra app (sitio/CMS) que comparte este proyecto Supabase
// — fuera de alcance de este repo, no se audita aquí (ver docs/SEGURIDAD.md).
//
//   node scripts/audit-public-schema-cu2.mjs --env dev|prod
// Necesita SUPABASE_ACCESS_TOKEN. On-demand (no en prebuild: necesita DB) — se
// ejecuta desde release-check.mjs antes de todo PR dev → main.
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const q = (sql) => dbQuery(env, sql);
console.log(`Auditoría de seguridad \`public\` (CU2) — entorno ${env.entorno} (${env.ref})\n`);

const tablas = await q(`
  select c.relname as tabla, c.relrowsecurity as rls_activa,
         exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e') as de_extension
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r';
`);

const gaps = [];
for (const t of tablas) {
  if (t.de_extension) continue; // tablas de extensiones (PostGIS, etc.) no son nuestras
  const privs = await q(`
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='${t.tabla.replace(/'/g, "''")}'
      and grantee in ('anon','authenticated','public');
  `);
  const pol = await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='${t.tabla.replace(/'/g, "''")}';`);
  const tienePolitica = pol[0]?.n > 0;
  if (!t.rls_activa) {
    gaps.push(`public.${t.tabla} — RLS DESACTIVADA (rls_disabled_in_public)`);
  } else if (privs.length && !tienePolitica) {
    gaps.push(`public.${t.tabla} — RLS activa pero SIN políticas y CON grant directo a ${[...new Set(privs.map((p) => p.grantee))].join('/')} (expuesta igual)`);
  }
}

if (!gaps.length) {
  console.log(`✓ Ninguna tabla de \`public\` expuesta sin RLS/política (${tablas.length} tabla(s) revisada(s)).`);
  process.exit(0);
}

console.log(`\n🔴 ${gaps.length} tabla(s) de \`public\` con el patrón de exposición de CU2:\n`);
for (const g of gaps) console.log(`   · ${g}`);
console.log('\nVer docs/SEGURIDAD.md — bloquear con RLS sin políticas + revoke a anon/authenticated,');
console.log('o agregar política explícita si de verdad debe ser alcanzable por la API.');
process.exit(1);
