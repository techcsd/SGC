// verify-sin-ref-hardcodeado.mjs — BU1 F3.5 — guard de prebuild: ningún archivo
// NUEVO o MODIFICADO en esta rama (src/, scripts/, supabase/functions/, sql/) puede
// llevar el ref de proyecto de prod literal. El ref vive SOLO en environment.*.ts,
// .env.local y el resolver de entorno (allowlist). Así ningún cron/edge/migración
// futura vuelve a escribir el ref (causa raíz de que un dev restaurado llamara a prod).
//
// Solo revisa lo que cambió vs `main` (los 621 SQL legacy que sí traen el ref no
// se tocan → no dan falso positivo). Sin git, avisa y pasa.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const PROD_REF = 'jeeqhgccqefbqilntcpu';
const SCOPES = ['src', 'scripts', 'supabase/functions', 'sql'];
// Únicos lugares donde el ref literal está PERMITIDO (fuente canónica).
const ALLOW = new Set([
  'src/environments/environment.prod.ts',
  'scripts/lib/entorno.mjs',
  'scripts/diff-esquema.mjs',
  'scripts/clone-schema-introspect.mjs', // herramienta de clon one-shot: lee prod por diseño
  'scripts/dev-fix-crons.mjs', // detecta el ref de prod en crons para reescribirlo
  'scripts/seed-dev.mjs', // aborta si el destino es prod (usa el ref como salvaguarda)
  'scripts/verify-sin-ref-hardcodeado.mjs',
]);

let changed;
try {
  const base = execSync('git merge-base HEAD main', { encoding: 'utf8' }).trim();
  const out = execSync(`git diff --name-only --diff-filter=AM ${base} HEAD -- ${SCOPES.join(' ')}`, { encoding: 'utf8' });
  // También incluye lo no committeado (working tree) en esos scopes.
  const wt = execSync(`git diff --name-only --diff-filter=AM -- ${SCOPES.join(' ')}`, { encoding: 'utf8' });
  const untracked = execSync(`git ls-files --others --exclude-standard -- ${SCOPES.join(' ')}`, { encoding: 'utf8' });
  changed = [...new Set((out + wt + untracked).split('\n').map((s) => s.trim()).filter(Boolean))];
} catch {
  console.log('⏭  verify-sin-ref-hardcodeado: sin contexto git — omitido.');
  process.exit(0);
}

const ofensores = [];
for (const f of changed) {
  if (ALLOW.has(f) || !existsSync(f)) continue;
  let txt;
  try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  if (txt.includes(PROD_REF)) ofensores.push(f);
}

if (ofensores.length) {
  console.error('\n🔴 Ref de proyecto de prod HARDCODEADO en archivos nuevos/modificados (regla 18):\n');
  for (const f of ofensores) console.error(`   ✗ ${f}`);
  console.error(`\nEl ref '${PROD_REF}' solo puede vivir en environment.*.ts / .env.local / el resolver de entorno.`);
  console.error('Usa el entorno (resolverEnv / SUPABASE_*_ENV) o sgc.config_entorno en vez del literal.\n');
  process.exit(1);
}
console.log(`✓ sin ref de prod hardcodeado (${changed.length} archivo(s) nuevos/modificados revisados).`);
