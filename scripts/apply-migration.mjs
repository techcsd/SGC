// apply-migration.mjs — BU1 F3.3 — aplica un .sql al proyecto del ENTORNO indicado
// vía Management API y lo REGISTRA en el ledger sgc.migraciones_aplicadas.
//
//   node scripts/apply-migration.mjs sql/2026-…​.sql --env dev
//   node scripts/apply-migration.mjs sql/2026-…​.sql --env dev --dry-run
//   node scripts/apply-migration.mjs sql/2026-…​.sql --env prod            (exige estar en ledger dev)
//   node scripts/apply-migration.mjs sql/2026-…​.sql --env prod --force-prod --motivo "hotfix X"
//
// REGLA 18: --env prod RECHAZA lo que no esté en el ledger de DEV con el mismo
// checksum, salvo --force-prod --motivo (que queda registrado como forzado).
// Sin --env el script NO corre (prod nunca es destino por defecto).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--') && a.endsWith('.sql'));
if (!file) { console.error('Uso: node scripts/apply-migration.mjs <archivo.sql> --env dev|prod [--dry-run] [--force-prod --motivo "…"]'); process.exit(1); }

const env = await resolverEnv(argv);
const dryRun = argv.includes('--dry-run');

const sql = readFileSync(file, 'utf8');
const archivo = file.replace(/\\/g, '/');
const checksum = createHash('sha256').update(sql).digest('hex');

async function dbq(ref, query) {
  for (let a = 0; ; a++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (res.status === 429 && a < 6) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) { const e = new Error(text); e.http = res.status; throw e; }
    try { return JSON.parse(text); } catch { return []; }
  }
}

// ── Regla 18: prod exige ledger de dev ───────────────────────────────────────
if (env.entorno === 'prod' && !env.forceProd) {
  const dev = process.env.SUPABASE_PROJECT_REF_DEV;
  let ok = false;
  if (dev) {
    try {
      const r = await dbq(dev, `select checksum from sgc.migraciones_aplicadas where archivo='${archivo}' limit 1`);
      ok = Array.isArray(r) && r[0] && r[0].checksum === checksum;
    } catch { ok = false; }
  }
  if (!ok) {
    console.error(`🔴 Esta migración no ha pasado por dev (o cambió su contenido).`);
    console.error(`   Aplícala con  --env dev,  pruébala en dev.sgcconstructorasd.com,  y vuelve.`);
    console.error(`   Si de verdad debe ir directo a prod:  --force-prod --motivo "…"`);
    process.exit(1);
  }
}

// ── Aplicar ──────────────────────────────────────────────────────────────────
let toRun = sql;
if (dryRun) {
  // Dry-run real: si la migración se auto-commitea, cambiamos el último commit por
  // rollback; si no, la envolvemos en begin/rollback.
  toRun = /commit\s*;\s*$/i.test(sql) ? sql.replace(/commit(\s*;\s*)$/i, 'rollback$1') : `begin;\n${sql}\nrollback;`;
}
try {
  await dbq(env.ref, toRun);
} catch (e) {
  console.error(`🔴 HTTP ${e.http ?? ''} al aplicar ${archivo} en ${env.entorno}:\n${String(e.message).slice(0, 800)}`);
  process.exit(1);
}
console.log(`✓ ${dryRun ? '[dry-run] ' : ''}aplicada: ${archivo} en ${env.entorno} (${env.ref})`);

// ── Registrar en el ledger (no en dry-run) ───────────────────────────────────
if (!dryRun) {
  const forzada = env.entorno === 'prod' && env.forceProd;
  const motivo = forzada && env.motivo ? env.motivo.replace(/'/g, "''") : null;
  const por = forzada ? 'xaviel' : 'claude-code';
  const q = `insert into sgc.migraciones_aplicadas (archivo,checksum,entorno,aplicada_por,forzada,motivo)
    values ('${archivo}','${checksum}','${env.entorno}','${por}',${forzada},${motivo ? `'${motivo}'` : 'null'})
    on conflict (archivo) do update set checksum=excluded.checksum, entorno=excluded.entorno, aplicada_en=now(), aplicada_por=excluded.aplicada_por, forzada=excluded.forzada, motivo=excluded.motivo`;
  try { await dbq(env.ref, q); console.log(`  ↳ registrada en ledger (${env.entorno}${forzada ? ', FORZADA: ' + env.motivo : ''})`); }
  catch (e) { console.error(`  ⚠️ aplicada pero NO registrada en ledger (¿existe sgc.migraciones_aplicadas?): ${String(e.message).slice(0, 160)}`); }
}
