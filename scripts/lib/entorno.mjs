// scripts/lib/entorno.mjs — BU1 F3.2 — resolución de entorno compartida por TODOS
// los scripts que tocan Supabase. Hace cumplir el corolario de la regla 18:
// **ningún script tiene prod como destino por defecto; sin `--env` no corre.**
//
//   import { resolverEnv } from './lib/entorno.mjs';
//   const env = await resolverEnv(process.argv.slice(2));
//   // env = { entorno, ref, url, serviceKey, token, yes, forcePll, motivo, argv }
//
// `--env dev|prod` es OBLIGATORIO. `--env prod` imprime un banner y exige
// confirmación (`--yes` para no interactivo / flujo con OK ya dado).
import './load-env.mjs';
import { createInterface } from 'node:readline';

const PROD_REF = 'jeeqhgccqefbqilntcpu'; // único literal permitido (junto a .env.local / environment.*)

function flag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function ayuda(msg) {
  console.error(`\n🔴 ${msg}\n`);
  console.error('Uso: <script> --env dev|prod [--yes] [--force-prod --motivo "…"]');
  console.error('  --env dev    → proyecto sgc-dev (SUPABASE_*_DEV en .env.local)');
  console.error('  --env prod   → PRODUCCIÓN (exige confirmación o --yes)');
  console.error('Sin --env el script NO corre (regla 18: prod nunca es el destino por defecto).\n');
  process.exit(1);
}

async function confirmarProd(ref, yes) {
  const banner = `\n\x1b[41m\x1b[97m ▶ PRODUCCIÓN (${ref}) \x1b[0m\n`;
  console.error(banner);
  if (yes) { console.error('  (--yes: confirmación omitida)\n'); return; }
  if (!process.stdin.isTTY) {
    ayuda('prod en modo no interactivo requiere --yes (confirmado por Xaviel).');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ans = await new Promise((res) => rl.question('  escribe "prod" para continuar: ', res));
  rl.close();
  if (ans.trim() !== 'prod') ayuda('confirmación no coincide — abortado.');
}

export async function resolverEnv(argv) {
  const entorno = flag(argv, '--env');
  if (entorno !== 'dev' && entorno !== 'prod') ayuda('falta --env dev|prod');

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) ayuda('falta SUPABASE_ACCESS_TOKEN en el entorno.');

  const SUF = entorno.toUpperCase();
  // El ref de prod es literal aquí (no cae por omisión: solo si --env prod explícito).
  const ref = process.env[`SUPABASE_PROJECT_REF_${SUF}`] || (entorno === 'prod' ? PROD_REF : null);
  if (!ref) ayuda(`falta SUPABASE_PROJECT_REF_${SUF} en .env.local`);
  const url = process.env[`SUPABASE_URL_${SUF}`] || `https://${ref}.supabase.co`;
  const serviceKey = process.env[`SUPABASE_SERVICE_ROLE_KEY_${SUF}`] || null;

  const yes = !!flag(argv, '--yes');
  const forceProd = !!flag(argv, '--force-prod');
  const motivo = typeof flag(argv, '--motivo') === 'string' ? flag(argv, '--motivo') : null;
  if (forceProd && !motivo) ayuda('--force-prod requiere --motivo "…"');

  if (entorno === 'prod') await confirmarProd(ref, yes);

  return { entorno, ref, url, serviceKey, token, yes, forceProd, motivo, argv };
}

// Helper: ejecutar SQL contra el ref del entorno vía Management API (con backoff 429).
export async function dbQuery(env, sql) {
  for (let a = 0; ; a++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (res.status === 429 && a < 6) { await new Promise((r) => setTimeout(r, 1500 * (a + 1))); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  }
}
