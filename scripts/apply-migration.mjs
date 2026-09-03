// apply-migration.mjs — aplica un archivo .sql contra el proyecto Supabase real
// vía la Management API (mismo canal que los smokes). Referenciado por el
// encabezado `Apply:` de cada migración en sql/.
//
// Uso:   node scripts/apply-migration.mjs sql/2026-09-03-bi1-bitacora-storage-update.sql
// Env:   SUPABASE_ACCESS_TOKEN (token de la Management API).
//
// No hace magia: envía el SQL tal cual al endpoint database/query. Las migraciones
// ya traen su propio begin/commit e idempotencia (drop policy if exists, etc.).
import { readFileSync } from 'node:fs';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'jeeqhgccqefbqilntcpu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/apply-migration.mjs <archivo.sql>'); process.exit(1); }

const sql = readFileSync(file, 'utf8');

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) },
);
const text = await res.text();
if (!res.ok) { console.error(`🔴 HTTP ${res.status}\n${text}`); process.exit(1); }
console.log(`✓ Aplicada: ${file}`);
try { const j = JSON.parse(text); if (Array.isArray(j) && j.length) console.log(JSON.stringify(j, null, 2)); } catch { /* sin filas */ }
