// backfill-ledger.mjs — BU1 F3.4 — inserta en el ledger del entorno los archivos
// de sql/ (por objeto ya estaban en prod / dev nace del clon) y las edges actuales,
// marcados `backfill-2026-09-18`. Idempotente (on conflict do nothing).
//
//   node scripts/backfill-ledger.mjs --env dev
//   node scripts/backfill-ledger.mjs --env prod            (gateado — F8, con --yes)
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { checksumEdge, listSlugs } from './lib/edge-files.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const env = await resolverEnv(process.argv.slice(2));
const POR = 'backfill-2026-09-18';
const MOTIVO = 'en prod por objeto antes del ledger';

async function sql(query) {
  for (let a = 0; ; a++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (res.status === 429 && a < 6) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return JSON.parse(text);
  }
}

// ── Migraciones ──────────────────────────────────────────────────────────────
const files = readdirSync('sql').filter((f) => f.endsWith('.sql')).sort();
const rows = files.map((f) => {
  const checksum = createHash('sha256').update(readFileSync(`sql/${f}`, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  return `('sql/${f}','${checksum}','${env.entorno}','${POR}','${MOTIVO}')`;
});
// Inserta en lotes de 200 filas.
let migOk = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const r = await sql(`insert into sgc.migraciones_aplicadas (archivo,checksum,entorno,aplicada_por,motivo)
    values ${chunk.join(',')} on conflict (archivo) do update set checksum=excluded.checksum`);
  migOk += chunk.length;
  void r;
}
console.log(`✓ migraciones backfilled: ${migOk}/${files.length}`);

// ── Edges ──────────────────────────────────────────────────────────────────--
const fns = await (async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/functions`, { headers: { Authorization: `Bearer ${env.token}` } });
  if (!res.ok) return [];
  return JSON.parse(await res.text());
})();
const versionBySlug = Object.fromEntries(fns.map((f) => [f.slug, f.version]));

const eRows = [];
for (const slug of listSlugs()) {
  const { checksum } = checksumEdge(slug);
  const ver = versionBySlug[slug] ?? null;
  eRows.push(`('${slug}','${checksum}','${env.entorno}',${ver ?? 'null'},'${POR}')`);
}
if (eRows.length) {
  await sql(`insert into sgc.edges_desplegadas (slug,checksum,entorno,version,desplegada_por)
    values ${eRows.join(',')} on conflict (slug,checksum,entorno) do nothing`);
}
console.log(`✓ edges backfilled: ${eRows.length}`);
console.log(`\nLedger de ${env.entorno} poblado (${migOk} migraciones + ${eRows.length} edges).`);
