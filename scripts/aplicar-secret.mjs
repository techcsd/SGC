// aplicar-secret.mjs — BU1 F2.2/F3.3 — siembra un secret de edge functions en el
// entorno indicado vía Management API. El VALOR nunca viene por argv: se lee de
// .env.local (clave `<NOMBRE>_<ENV>` o `<NOMBRE>`) o, si falta, de un prompt oculto.
// Registra el NOMBRE (nunca el valor) en sgc.secrets_aplicados (best-effort).
//
//   node scripts/aplicar-secret.mjs --env dev NOMBRE [--value-env OTRA_CLAVE]
//   node scripts/aplicar-secret.mjs --env dev NOMBRE --value "literal"   (evítalo; preferir env)
//
// Regla 18: --env prod exige que el secret ya exista en el ledger de dev (o --force-prod).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const env = await resolverEnv(argv);

// El nombre del secret = primer arg en MAYÚSCULAS (evita colisión con flags).
const NOMBRE = argv.find((a) => /^[A-Z][A-Z0-9_]+$/.test(a));
if (!NOMBRE) { console.error('Falta el NOMBRE del secret (MAYÚSCULAS).'); process.exit(1); }

function flag(name) { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; }

async function valor() {
  const lit = flag('--value');
  if (lit) return lit;
  const alt = flag('--value-env');
  const candidates = [alt, `${NOMBRE}_${env.entorno.toUpperCase()}`, NOMBRE].filter(Boolean);
  for (const k of candidates) if (process.env[k]) return process.env[k];
  if (!process.stdin.isTTY) { console.error(`No hay valor para ${NOMBRE} (ni en .env.local ni --value). En no interactivo, define ${NOMBRE}_${env.entorno.toUpperCase()} en .env.local.`); process.exit(1); }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const v = await new Promise((res) => rl.question(`valor para ${NOMBRE} (oculto no soportado, pega): `, res));
  rl.close();
  return v.trim();
}

async function enLedgerDev(n) {
  const dev = process.env.SUPABASE_PROJECT_REF_DEV;
  if (!dev) return false;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${dev}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `select 1 from sgc.secrets_aplicados where nombre='${n}' and entorno='dev' limit 1` }),
    });
    if (!res.ok) return false;
    const j = JSON.parse(await res.text());
    return Array.isArray(j) && j.length > 0;
  } catch { return false; }
}

async function registrar(n) {
  try {
    await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `insert into sgc.secrets_aplicados (nombre,entorno) values ('${n}','${env.entorno}') on conflict (nombre,entorno) do update set aplicado_en=now()` }),
    });
  } catch { /* ledger aún no existe */ }
}

if (env.entorno === 'prod' && !env.forceProd && !(await enLedgerDev(NOMBRE))) {
  console.error(`🔴 ${NOMBRE}: no está en el ledger de dev. Aplícalo a dev primero o usa --force-prod --motivo "…".`);
  process.exit(1);
}

const v = await valor();
const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/secrets`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: NOMBRE, value: v }]),
});
if (!res.ok) { console.error(`🔴 ${NOMBRE} HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
await registrar(NOMBRE);
console.log(`✓ secret ${NOMBRE} aplicado en ${env.entorno} (${env.ref}) — valor no impreso`);
