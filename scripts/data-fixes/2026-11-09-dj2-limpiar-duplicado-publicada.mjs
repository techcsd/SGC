// Corrección de datos (CD10) — sgc.app_versiones (plataforma='movil') tenía
// DOS filas con publicada=true (2.66.3 real + 2.50.0 stale, fuera de la
// ventana de las últimas 10 filas) incluso tras instalar el trigger
// trg_app_versiones_publicada_unica (sql/2026-11-05-dj-publicada-unica-trigger.sql),
// porque el trigger solo actúa en INSERT/UPDATE futuros, no retroactivo.
//
// Fix: reafirmar publicada=true en la versión real vigente dispara el
// trigger, que apaga cualquier otra fila de la misma plataforma — sin tocar
// el archivo viejo sql-para-sgc/2026-11-05-dj-publicar-2.66.2-hotfix-crash.sql
// (quedó obsoleto: fijaba 2.66.2, pero 2.66.3 ya es la real publicada en
// prod desde el incidente original).
//
//   node scripts/data-fixes/2026-11-09-dj2-limpiar-duplicado-publicada.mjs --env dev
//   node scripts/data-fixes/2026-11-09-dj2-limpiar-duplicado-publicada.mjs --env prod --yes
import '../lib/load-env.mjs';
import { resolverEnv } from '../lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

async function dbq(ref, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

const before = await dbq(env.ref, `select version, fecha from sgc.app_versiones where plataforma='movil' and publicada order by fecha desc`);
console.log(`[${env.entorno}] Antes (publicada=true):`, before);

if (before.length <= 1) {
  console.log(`[${env.entorno}] Ya hay 0 o 1 fila publicada=true — nada que corregir.`);
  process.exit(0);
}

const vigente = before.reduce((a, b) => (a.fecha >= b.fecha ? a : b));
console.log(`[${env.entorno}] Reafirmando publicada=true en la más reciente (dispara el trigger):`, vigente.version);
await dbq(env.ref, `update sgc.app_versiones set publicada = true where plataforma='movil' and version = '${vigente.version}'`);

const after = await dbq(env.ref, `select version, fecha from sgc.app_versiones where plataforma='movil' and publicada order by fecha desc`);
console.log(`[${env.entorno}] Después:`, after);
