// audit-notnull-sin-default.mjs — BF1 (convención permanente, ver
// docs/CHECKLIST-MIGRACIONES.md). Regla: toda columna NOT NULL nueva NACE con
// DEFAULT o con backfill (UPDATE ... SET col) en la MISMA migración. Si no, el
// primer INSERT que omita/mande null la columna revienta en prod (fue BF1:
// crear proveedor → "null value in column is_hardware_store").
//
// Escaneo ESTÁTICO de sql/ (no necesita DB) → corre en prebuild como los demás
// guardas (check-ambiguous-embeds, verify-regresiones).
//
// Uso:  node scripts/audit-notnull-sin-default.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL_DIR = join(process.cwd(), 'sql');

// `alter table ... add column [if not exists] <col> <tipo...> not null ...;`
// Capturamos hasta el `;` para saber si ese MISMO statement trae un default.
const ADD_COL = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?[^;]*?\bnot\s+null\b[^;]*?;/gis;

const offenders = [];
let files;
try {
  files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql'));
} catch {
  console.log('audit-notnull: no existe sql/, nada que revisar.');
  process.exit(0);
}

for (const file of files) {
  const sql = readFileSync(join(SQL_DIR, file), 'utf8');
  const lower = sql.toLowerCase();
  let m;
  ADD_COL.lastIndex = 0;
  while ((m = ADD_COL.exec(sql)) !== null) {
    const stmt = m[0];
    const col = m[1];
    if (/\bdefault\b/i.test(stmt)) continue; // trae default en el mismo statement → OK
    // ¿Hay un backfill de esa columna en el mismo archivo? (update ... set col ...)
    const backfill = new RegExp(`update\\s+[^;]*?\\bset\\b[^;]*?\\b${col}\\b`, 'is');
    if (backfill.test(lower)) continue; // backfill presente → OK
    offenders.push({ file, col });
  }
}

if (!offenders.length) {
  console.log('✓ audit-notnull: ninguna columna NOT NULL nueva sin default ni backfill.');
  process.exit(0);
}

console.error('\n✗ audit-notnull — columnas NOT NULL nuevas SIN default ni backfill (regla BF1):\n');
for (const o of offenders) console.error(`   · ${o.file} → columna "${o.col}"`);
console.error(
  '\nCada una debe nacer con DEFAULT o con un UPDATE de backfill en la MISMA migración,\n' +
  'o el primer INSERT que la omita reventará en prod. Ver docs/CHECKLIST-MIGRACIONES.md.\n',
);
process.exit(1);
