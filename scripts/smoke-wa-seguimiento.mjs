// smoke-wa-seguimiento.mjs — DL4/F4 — crea un grupo+hallazgo de prueba, enciende
// la familia SOLO durante la prueba, llama la edge real (cron, x-sync-secret),
// confirma el recordatorio en sgc.wa_recordatorios, y limpia todo (incl. dejar
// la familia apagada otra vez). Uso: node scripts/smoke-wa-seguimiento.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 Este smoke solo corre en dev.'); process.exit(1); }

const INFRA_SYNC_SECRET = process.env[`INFRA_SYNC_SECRET_${env.entorno.toUpperCase()}`];
if (!INFRA_SYNC_SECRET) { console.error(`🔴 Falta INFRA_SYNC_SECRET_${env.entorno.toUpperCase()} en .env.local.`); process.exit(1); }

const GRUPO_JID = 'smoke-wa-seguimiento@test';

async function q(sql) { return dbQuery(env, sql); }

console.log('1) Creando grupo + hallazgo de prueba (seguimiento activo, 25h de antigüedad)...');
await q(`
  insert into sgc.wa_grupos (jid, nombre, modo) values ('${GRUPO_JID}', 'Smoke wa-seguimiento', 'memoria')
  on conflict (jid) do nothing;
`);
const [{ id: tecId }] = await q(`select id from sgc.usuarios where lower(email) = lower('Tecnologia@constructorasd.com') limit 1;`);
if (!tecId) { console.error('🔴 No se encontró el usuario Tecnologia@constructorasd.com en dev.'); process.exit(1); }

await q(`delete from sgc.wa_hallazgos where grupo_jid = '${GRUPO_JID}';`);
const [{ id: hallazgoId }] = await q(`
  insert into sgc.wa_hallazgos (grupo_jid, tipo, resumen, confianza, responsable_id, responsable_origen, seguimiento, seguimiento_desde)
  values ('${GRUPO_JID}', 'tarea', 'SMOKE: confirmar entrega de prueba', 0.9, '${tecId}', 'tecnologia', 'activo', now() - interval '25 hours')
  returning id;
`);
console.log(`   hallazgo ${hallazgoId}`);

console.log('2) Encendiendo la familia wa_recordatorios (solo para esta prueba)...');
await q(`update sgc.envios_automaticos set activo = true where familia = 'wa_recordatorios';`);

try {
  console.log('3) Llamando la edge wa-seguimiento (x-sync-secret, corrida real)...');
  const res = await fetch(`${env.url}/functions/v1/wa-seguimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': INFRA_SYNC_SECRET },
    body: '{}',
  });
  const body = await res.json().catch(() => ({}));
  console.log(`   HTTP ${res.status}`, JSON.stringify(body));
  if (!res.ok) throw new Error(`edge devolvió ${res.status}`);

  console.log('4) Verificando sgc.wa_recordatorios...');
  const filas = await q(`select canal, estado, nivel, motivo from sgc.wa_recordatorios where '${hallazgoId}' = any(hallazgo_ids) order by canal;`);
  console.log(JSON.stringify(filas, null, 2));
  if (!filas.length) throw new Error('No se registró ningún recordatorio — revisar.');

  console.log('5) Verificando que wa_hallazgos.recordatorios_enviados subió...');
  const [h] = await q(`select recordatorios_enviados, ultimo_recordatorio_en from sgc.wa_hallazgos where id = '${hallazgoId}';`);
  console.log(JSON.stringify(h));
  if (!h.recordatorios_enviados || h.recordatorios_enviados < 1) throw new Error('recordatorios_enviados no subió.');

  console.log('✅ Smoke OK.');
} finally {
  console.log('6) Limpiando (borra el grupo/hallazgo/log de prueba, apaga la familia otra vez)...');
  await q(`delete from sgc.wa_recordatorios where '${hallazgoId}' = any(hallazgo_ids);`);
  await q(`delete from sgc.wa_hallazgos where grupo_jid = '${GRUPO_JID}';`);
  await q(`delete from sgc.wa_grupos where jid = '${GRUPO_JID}';`);
  await q(`update sgc.envios_automaticos set activo = false where familia = 'wa_recordatorios';`);
  console.log('   listo.');
}
