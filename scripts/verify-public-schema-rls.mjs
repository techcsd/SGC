// verify-public-schema-rls.mjs — CU2 (fila 269, prioridad máxima; ver
// sql/2026-10-20-cu2-public-default-privileges.sql y docs/SEGURIDAD.md).
// Convención de este repo: el SGC vive ENTERO en el esquema `sgc`. Cualquier
// `create table public.…` en una migración es, por definición, sospechoso — así
// llegó `n8n_chat_histories` a quedar expuesta por la API (CT9/CU2): una tabla en
// `public` SIN RLS hereda — hasta la migración cu2 que cerró el default — acceso
// automático de anon/authenticated y, aunque ese default ya se cerró, una tabla
// sin RLS en un esquema expuesto por el Data API (`public` está en db_schema junto
// a `sgc`) sigue siendo un riesgo si alguna vez se le hace un GRANT directo.
//
// Escaneo ESTÁTICO de sql/ (no necesita DB) → corre en prebuild como los demás
// guardas. Regla: toda migración que haga `create table public.<tabla>` debe,
// en el MISMO archivo, activar RLS para esa tabla (`alter table … enable row
// level security` o `enable row level security` en el propio `create table`).
//
// Uso:  node scripts/verify-public-schema-rls.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL_DIR = join(process.cwd(), 'sql');

const CREATE_PUBLIC = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi;

const offenders = [];
let files;
try {
  files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'));
} catch {
  console.log('verify-public-schema-rls: no existe sql/, nada que revisar.');
  process.exit(0);
}

for (const file of files) {
  const sql = readFileSync(join(SQL_DIR, file), 'utf8');
  const lower = sql.toLowerCase();
  let m;
  CREATE_PUBLIC.lastIndex = 0;
  while ((m = CREATE_PUBLIC.exec(sql)) !== null) {
    const tabla = m[1].toLowerCase();
    const rlsOn = new RegExp(`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?public\\.${tabla}\\b[^;]*?enable\\s+row\\s+level\\s+security`, 'is').test(lower)
      || new RegExp(`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?${tabla}\\b[^;]*?enable\\s+row\\s+level\\s+security`, 'is').test(lower);
    if (!rlsOn) offenders.push({ file, tabla });
  }
}

if (!offenders.length) {
  console.log('✓ verify-public-schema-rls: ninguna tabla nueva de public sin RLS en la misma migración.');
  process.exit(0);
}

console.error('\n✗ verify-public-schema-rls — tabla(s) NUEVA(S) en `public` SIN activar RLS en la misma migración (regla CU2):\n');
for (const o of offenders) console.error(`   · ${o.file} → public.${o.tabla}`);
console.error(
  '\nEl SGC vive en `sgc`, no en `public`. Si de verdad necesitas una tabla en `public`,\n' +
  'la MISMA migración debe activar `enable row level security` (sin políticas si nadie\n' +
  'debe leerla por la API, o con políticas explícitas si sí). Ver docs/SEGURIDAD.md y\n' +
  'sql/2026-10-20-cu2-public-default-privileges.sql.\n',
);
process.exit(1);
