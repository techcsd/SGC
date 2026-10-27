// boveda-generar-clave.mjs — CZ3/CZ9. Genera la llave maestra del Vault
// (BOVEDA_MASTER_KEY, 32 bytes aleatorios en base64) y la aplica DIRECTO como
// secret de la edge `boveda` — la llave NUNCA se imprime, nunca toca un
// archivo ni argv; vive solo en memoria de este proceso hasta el POST a la
// Management API. Distinta por entorno (regla DZ-09): correr una vez por
// --env dev y, cuando Xaviel lo decida, una vez (aparte) por --env prod.
//
//   node scripts/boveda-generar-clave.mjs --env dev
//
// Regla 18: --env prod exige que el secret ya esté en el ledger de dev
// (mismo candado que aplicar-secret.mjs) — pero genera una llave NUEVA y
// DISTINTA para prod, nunca reusa la de dev.
import './lib/load-env.mjs';
import { randomBytes } from 'node:crypto';
import { resolverEnv } from './lib/entorno.mjs';

const NOMBRE = 'BOVEDA_MASTER_KEY';
const env = await resolverEnv(process.argv.slice(2));

async function enLedgerDev() {
  const dev = process.env.SUPABASE_PROJECT_REF_DEV;
  if (!dev) return false;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${dev}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `select 1 from sgc.secrets_aplicados where nombre='${NOMBRE}' and entorno='dev' limit 1` }),
    });
    if (!res.ok) return false;
    const j = JSON.parse(await res.text());
    return Array.isArray(j) && j.length > 0;
  } catch { return false; }
}

async function registrar() {
  try {
    await fetch(`https://api.supabase.com/v1/projects/${env.ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `insert into sgc.secrets_aplicados (nombre,entorno) values ('${NOMBRE}','${env.entorno}') on conflict (nombre,entorno) do update set aplicado_en=now()` }),
    });
  } catch { /* ledger aún no existe */ }
}

if (env.entorno === 'prod' && !env.forceProd && !(await enLedgerDev())) {
  console.error(`🔴 ${NOMBRE}: no está en el ledger de dev. Genérala primero con --env dev (son llaves DISTINTAS por entorno, a propósito).`);
  process.exit(1);
}

// 32 bytes aleatorios (AES-256) en base64 — generado en memoria, nunca impreso.
const llave = randomBytes(32).toString('base64');

const res = await fetch(`https://api.supabase.com/v1/projects/${env.ref}/secrets`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: NOMBRE, value: llave }]),
});
if (!res.ok) { console.error(`🔴 ${NOMBRE} HTTP ${res.status}: ${await res.text()}`); process.exit(1); }
await registrar();
console.log(`✓ ${NOMBRE} generada y aplicada en ${env.entorno} (${env.ref}) — llave NO impresa, NO guardada en ningún archivo.`);
console.log(`  ⚠️  Custodia física: sin esta llave (ni un segundo propietario del proyecto de Supabase), el Vault de ${env.entorno} no se abre jamás. Es responsabilidad de Xaviel anotarla fuera de línea (ver §6 del contexto de la ronda).`);
