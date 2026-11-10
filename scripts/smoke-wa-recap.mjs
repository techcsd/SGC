// smoke-wa-recap.mjs — DL5/F5 — crea un grupo + mensajes + hallazgo sintéticos,
// enciende la familia SOLO durante la prueba, llama la edge real (cron,
// x-sync-secret), confirma wa_resumenes/wa_recap_envios, y limpia todo (incl.
// dejar la familia apagada otra vez). Uso: node scripts/smoke-wa-recap.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 Este smoke solo corre en dev.'); process.exit(1); }

const INFRA_SYNC_SECRET = process.env[`INFRA_SYNC_SECRET_${env.entorno.toUpperCase()}`];
if (!INFRA_SYNC_SECRET) { console.error(`🔴 Falta INFRA_SYNC_SECRET_${env.entorno.toUpperCase()} en .env.local.`); process.exit(1); }

const GRUPO_JID = 'smoke-wa-recap@test';

async function q(sql) { return dbQuery(env, sql); }

console.log('1) Creando grupo + 6 mensajes sintéticos (≥ mínimo) + 1 hallazgo abierto...');
await q(`
  insert into sgc.wa_grupos (jid, nombre, modo) values ('${GRUPO_JID}', 'Smoke wa-recap', 'memoria')
  on conflict (jid) do nothing;
  delete from sgc.wa_hallazgos where grupo_jid = '${GRUPO_JID}';
  delete from sgc.wa_mensajes_grupo where grupo_jid = '${GRUPO_JID}';
  delete from sgc.wa_recap_cursor where grupo_jid = '${GRUPO_JID}';
  delete from sgc.wa_resumenes where grupo_jid = '${GRUPO_JID}';
`);
await q(`
  insert into sgc.wa_mensajes_grupo (wa_message_id, grupo_jid, autor_telefono, autor_nombre, tipo, texto, enviado_en)
  select 'smoke-' || gs, '${GRUPO_JID}', '8095551111', 'Smoke Bot', 'texto',
    'Mensaje de prueba número ' || gs || ' — se necesitan 20 bloques para la losa',
    now() - (gs || ' minutes')::interval
  from generate_series(1, 6) gs;
`);
const [{ id: tecId }] = await q(`select id from sgc.usuarios where lower(email) = lower('Tecnologia@constructorasd.com') limit 1;`);
await q(`
  insert into sgc.wa_hallazgos (grupo_jid, tipo, resumen, confianza, responsable_id, responsable_origen, seguimiento, seguimiento_desde)
  values ('${GRUPO_JID}', 'pedido_material', 'SMOKE: pendiente de confirmar llegada de bloques', 0.8, '${tecId}', 'tecnologia', 'activo', now());
`);

console.log('2) Encendiendo la familia wa_recap_diario (solo para esta prueba)...');
await q(`update sgc.envios_automaticos set activo = true where familia = 'wa_recap_diario';`);

try {
  console.log('3) Llamando la edge wa-recap (x-sync-secret, tarea=dia)...');
  const res = await fetch(`${env.url}/functions/v1/wa-recap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': INFRA_SYNC_SECRET },
    body: JSON.stringify({ tarea: 'dia' }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`   HTTP ${res.status}`, JSON.stringify(body));
  if (!res.ok) throw new Error(`edge devolvió ${res.status}`);

  console.log('4) Verificando sgc.wa_resumenes...');
  const resumenes = await q(`select periodo, mensajes_cubiertos, resumen, jsonb_array_length(pendientes) as n_pendientes, pdf_path from sgc.wa_resumenes where grupo_jid = '${GRUPO_JID}';`);
  console.log(JSON.stringify(resumenes, null, 2));
  if (!resumenes.length) throw new Error('No se generó wa_resumenes — revisar (¿mensajes_cubiertos < mínimo?).');
  if (resumenes[0].mensajes_cubiertos < 6) throw new Error('mensajes_cubiertos no coincide con los 6 sintéticos.');
  if (resumenes[0].n_pendientes < 1) throw new Error('El hallazgo abierto no quedó en "pendientes".');

  console.log('5) Verificando sgc.wa_recap_cursor avanzó...');
  const cursor = await q(`select hasta from sgc.wa_recap_cursor where grupo_jid = '${GRUPO_JID}' and periodo = 'dia';`);
  console.log(JSON.stringify(cursor));
  if (!cursor.length) throw new Error('El cursor no avanzó.');

  console.log('6) Verificando sgc.wa_recap_envios (debería haber un envío a Tecnología, destinatario sembrado por dl5)...');
  const envios = await q(`select usuario_id, estado, pdf_path from sgc.wa_recap_envios where '${GRUPO_JID}' = any(grupos);`);
  console.log(JSON.stringify(envios, null, 2));

  console.log('✅ Smoke OK.');
} finally {
  console.log('7) Limpiando (borra grupo/mensajes/hallazgo/resumen/cursor/envíos de prueba, apaga la familia otra vez)...');
  await q(`
    delete from sgc.wa_recap_envios where '${GRUPO_JID}' = any(grupos);
    delete from sgc.wa_resumenes where grupo_jid = '${GRUPO_JID}';
    delete from sgc.wa_recap_cursor where grupo_jid = '${GRUPO_JID}';
    delete from sgc.wa_hallazgos where grupo_jid = '${GRUPO_JID}';
    delete from sgc.wa_mensajes_grupo where grupo_jid = '${GRUPO_JID}';
    delete from sgc.wa_grupo_destinatarios where grupo_jid = '${GRUPO_JID}';
    delete from sgc.wa_grupos where jid = '${GRUPO_JID}';
    update sgc.envios_automaticos set activo = false where familia = 'wa_recap_diario';
  `);
  console.log('   listo.');
}
