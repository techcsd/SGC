// deploy-edge.mjs — BU1 F2.1/F3.3 — despliega edge functions vía Management API
// (el CLI de Supabase está bloqueado por Application Control). Se mudó de
// scratchpad/ a scripts/ y ahora exige `--env dev|prod` (regla 18).
//
//   node scripts/deploy-edge.mjs --env dev --all
//   node scripts/deploy-edge.mjs --env dev --slug notificar-flota
//   node scripts/deploy-edge.mjs --env prod --slug notificar-flota            (exige estar en ledger dev)
//   node scripts/deploy-edge.mjs --env prod --slug X --force-prod --motivo "…"
//
// verify_jwt sale de supabase/config.toml. Bundlea index.ts + _shared/** si se
// importa. Registra en sgc.edges_desplegadas (best-effort si la tabla no existe).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { collectFiles, checksumEdge, verifyJwtMap, listSlugs, FN_ROOT } from './lib/edge-files.mjs';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const argv = process.argv.slice(2);

async function mgmt(ref, path, opts) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    ...opts,
  });
  return res;
}
async function sql(ref, query) {
  const res = await mgmt(ref, '/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(text); e.http = res.status; throw e; }
  return JSON.parse(text);
}

async function enLedgerDev(slug, sum) {
  const dev = process.env.SUPABASE_PROJECT_REF_DEV;
  if (!dev) return false;
  try {
    const r = await sql(dev, `select 1 from sgc.edges_desplegadas where slug='${slug}' and checksum='${sum}' and entorno='dev' limit 1`);
    return Array.isArray(r) && r.length > 0;
  } catch { return false; } // tabla ausente → no verificable
}

async function registrar(env, slug, sum, version) {
  const forzada = env.entorno === 'prod' && env.forceProd;
  const motivo = forzada ? String(env.motivo).replace(/'/g, "''") : null;
  const q = `insert into sgc.edges_desplegadas (slug,checksum,entorno,version,desplegada_por,forzada,motivo)
    values ('${slug}','${sum}','${env.entorno}',${version ?? 'null'},'${forzada ? 'xaviel' : 'claude-code'}',${forzada},${motivo ? `'${motivo}'` : 'null'})
    on conflict (slug,checksum,entorno) do update set version=excluded.version, desplegada_en=now(), forzada=excluded.forzada, motivo=excluded.motivo`;
  try { await sql(env.ref, q); return true; } catch { return false; } // ledger aún no existe (F2 antes de F3)
}

async function deployOne(env, slug, vmap) {
  const { checksum: sum, files } = checksumEdge(slug);
  const verify_jwt = vmap[slug] ?? true;

  if (env.entorno === 'prod' && !env.forceProd) {
    if (!(await enLedgerDev(slug, sum))) {
      console.error(`🔴 ${slug}: este checksum NO está en el ledger de dev. Despliega a dev y pruébalo primero, o usa --force-prod --motivo "…".`);
      return { slug, skipped: true };
    }
  }

  const entryRel = `${slug}/index.ts`;
  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify({ entrypoint_path: entryRel, name: slug, verify_jwt })], { type: 'application/json' }));
  for (const f of files) {
    const rel = relative(FN_ROOT, f).replace(/\\/g, '/');
    const type = rel.endsWith('.json') ? 'application/json' : 'application/typescript';
    fd.append('file', new Blob([readFileSync(f)], { type }), rel);
  }
  for (let a = 0; ; a++) {
    const res = await mgmt(env.ref, `/functions/deploy?slug=${encodeURIComponent(slug)}`, { method: 'POST', body: fd });
    const text = await res.text();
    if (res.status === 429 && a < 6) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) throw new Error(`${slug} HTTP ${res.status}: ${text}`);
    const j = JSON.parse(text);
    const led = await registrar(env, slug, sum, j.version);
    console.log(`✓ ${slug} → v${j.version} verify_jwt=${j.verify_jwt}${led ? '' : ' (ledger n/a)'}`);
    return { slug, version: j.version };
  }
}

const env = await resolverEnv(argv);
const vmap = verifyJwtMap();

let slugs;
if (argv.includes('--all')) {
  slugs = listSlugs();
} else {
  const one = argv[argv.indexOf('--slug') + 1];
  if (!argv.includes('--slug') || !one) { console.error('Falta --slug <nombre> o --all'); process.exit(1); }
  slugs = [one];
}

console.log(`▶ deploy edges → ${env.entorno} (${env.ref}) — ${slugs.length} función(es)\n`);
const results = [];
for (const s of slugs) {
  try { results.push(await deployOne(env, s, vmap)); }
  catch (e) { console.error(`🔴 ${s}: ${String(e.message).slice(0, 200)}`); results.push({ slug: s, error: true }); }
}
const ok = results.filter((r) => r.version).length;
const skip = results.filter((r) => r.skipped).length;
const err = results.filter((r) => r.error).length;
console.log(`\n${ok} desplegada(s), ${skip} omitida(s por regla 18), ${err} error(es).`);
if (err) process.exit(1);
