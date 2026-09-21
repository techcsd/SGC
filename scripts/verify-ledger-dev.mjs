// verify-ledger-dev.mjs — BU1 F7.4 — usado por la GitHub Action en PR a `main`:
// comprueba que TODA migración (sql/*.sql) y edge (supabase/functions/**) TOCADA
// en el PR ya esté en el ledger de DEV con el MISMO checksum. Es la regla 18 en CI:
// nada llega a main (prod) sin haber vivido en dev.
//
//   node scripts/verify-ledger-dev.mjs --base origin/main
// Env (secrets del repo): SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF_DEV
import './lib/load-env.mjs';
import { checksumEdge } from './lib/edge-files.mjs';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DEV = process.env.SUPABASE_PROJECT_REF_DEV;
if (!TOKEN || !DEV) { console.error('faltan SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF_DEV (secrets del repo).'); process.exit(1); }
const base = (() => { const i = process.argv.indexOf('--base'); return i !== -1 ? process.argv[i + 1] : 'origin/main'; })();

async function devSql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${DEV}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return JSON.parse(await r.text());
}

let changed;
try { changed = execSync(`git diff --name-only ${base}...HEAD -- sql supabase/functions`, { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean); }
catch (e) { console.error('no pude obtener el diff vs ' + base, e.message); process.exit(1); }

const faltan = [];

// Migraciones tocadas.
const sqls = changed.filter((f) => f.startsWith('sql/') && f.endsWith('.sql'));
for (const f of sqls) {
  const checksum = createHash('sha256').update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  const r = await devSql(`select 1 from sgc.migraciones_aplicadas where archivo='${f}' and checksum='${checksum}' limit 1`);
  if (!(Array.isArray(r) && r.length)) faltan.push(`migración ${f} (no está en dev con este checksum)`);
}

// Edges tocadas (una por carpeta de función).
const slugs = [...new Set(changed.filter((f) => f.startsWith('supabase/functions/') && !f.includes('/_shared/')).map((f) => f.split('/')[2]).filter(Boolean))];
for (const slug of slugs) {
  let checksum;
  try { ({ checksum } = checksumEdge(slug)); } catch { continue; }
  const r = await devSql(`select 1 from sgc.edges_desplegadas where slug='${slug}' and checksum='${checksum}' and entorno='dev' limit 1`);
  if (!(Array.isArray(r) && r.length)) faltan.push(`edge ${slug} (no desplegada en dev con este checksum)`);
}

if (faltan.length) {
  console.error('\n🔴 Regla 18 — esto NO ha pasado por dev:\n');
  faltan.forEach((x) => console.error('   ✗ ' + x));
  console.error('\nAplícalo/despliégalo a dev (--env dev), pruébalo en dev.sgcconstructorasd.com, y vuelve a empujar.');
  console.error('Si de verdad debe ir directo a prod, hazlo con --force-prod --motivo "…" (queda registrado).\n');
  process.exit(1);
}
console.log(`✓ regla 18: ${sqls.length} migración(es) + ${slugs.length} edge(s) del PR están en el ledger de dev.`);
