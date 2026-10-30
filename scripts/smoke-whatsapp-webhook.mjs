// scripts/smoke-whatsapp-webhook.mjs — DC9 — smoke test del webhook oficial de
// WhatsApp Cloud API SIN necesitar una cuenta de Meta: arma un payload con la
// MISMA forma que manda Meta, lo firma con el WHATSAPP_APP_SECRET de dev (test),
// y lo postea contra la edge `whatsapp-webhook` desplegada en dev. Verifica:
//   1. GET de verificación devuelve el challenge.
//   2. Firma inválida → 401.
//   3. wa_message_id duplicado se procesa UNA sola vez (dedupe).
//   4. Número NO autorizado → no_autorizado, sin llamar a Claude.
//   5. Número autorizado (de prueba, sembrado por este script) llega hasta `assistant`.
//
// El envío real por Graph API fallará (WHATSAPP_TOKEN de dev es un placeholder
// hasta que Xaviel conecte el número de prueba de Meta) — eso es ESPERADO; el
// smoke verifica que quede registrado como error con mensaje amable, no que el
// envío real funcione.
//
//   node scripts/smoke-whatsapp-webhook.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
import { createHmac } from 'node:crypto';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') {
  console.error('🔴 Este smoke SOLO corre contra dev (siembra datos de prueba falsos).');
  process.exit(1);
}

const APP_SECRET = process.env.WHATSAPP_APP_SECRET_DEV;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN_DEV;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID_DEV ?? '000000000000000';
if (!APP_SECRET || !VERIFY_TOKEN) {
  console.error('🔴 Falta WHATSAPP_APP_SECRET_DEV / WHATSAPP_VERIFY_TOKEN_DEV en .env.local (los genera/aplica la ronda DC — ver docs/WHATSAPP-COMPA.md).');
  process.exit(1);
}

const WEBHOOK_URL = `${env.url}/functions/v1/whatsapp-webhook`;
const TEST_PHONE = '8095551234'; // número de prueba, nunca real
const TEST_PHONE_NO_AUTORIZADO = '8091110000';

function firmar(cuerpo) {
  return 'sha256=' + createHmac('sha256', APP_SECRET).update(cuerpo).digest('hex');
}

function payloadMensaje({ from, id, body, phoneNumberId = PHONE_NUMBER_ID }) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'test-waba-id',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '18296191631', phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: 'Prueba DC' }, wa_id: from }],
          messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
        },
      }],
    }],
  });
}

async function postFirmado(cuerpo, { firmaValida = true } = {}) {
  const firma = firmaValida ? firmar(cuerpo) : 'sha256=' + 'f'.repeat(64);
  return fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma }, body: cuerpo });
}

async function esperar(fn, { timeoutMs = 20000, intervalMs = 1500 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fn();
    if (r) return r;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return null;
}

const resultados = [];
function reportar(id, ok, detalle) {
  resultados.push({ id, ok });
  console.log(`${ok ? '✅' : '🔴'} ${id}${detalle ? ` — ${detalle}` : ''}`);
}

console.log(`▶ Smoke whatsapp-webhook contra dev (${WEBHOOK_URL})\n`);

// ── Setup: whitelist de prueba (idempotente, SOLO dev) ──────────────────────
const [usuario] = await dbQuery(env, `select id from sgc.usuarios where email = 'tecnologia@constructorasd.com' limit 1`);
if (!usuario?.id) { console.error('🔴 No existe tecnologia@constructorasd.com en dev — no se puede sembrar la prueba.'); process.exit(1); }
await dbQuery(env, `
  insert into sgc.whatsapp_autorizados (telefono, usuario_id, nota)
  values ('${TEST_PHONE}', '${usuario.id}'::uuid, 'smoke DC9 — número de prueba, nunca real')
  on conflict (telefono) do update set activo = true, usuario_id = excluded.usuario_id`);
await dbQuery(env, `delete from sgc.whatsapp_mensajes where telefono in ('${TEST_PHONE}', '${TEST_PHONE_NO_AUTORIZADO}')`);
await dbQuery(env, `delete from sgc.whatsapp_conversaciones where telefono in ('${TEST_PHONE}', '${TEST_PHONE_NO_AUTORIZADO}')`);

try {
  // ── 1) GET de verificación ────────────────────────────────────────────────
  {
    const challenge = `reto-${Date.now()}`;
    const url = `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=${challenge}`;
    const res = await fetch(url);
    const texto = await res.text();
    reportar('GET verificación devuelve el challenge', res.status === 200 && texto === challenge, `status=${res.status} body="${texto}"`);
  }

  // ── 2) Firma inválida → 401 ──────────────────────────────────────────────
  {
    const cuerpo = payloadMensaje({ from: TEST_PHONE, id: `wamid.smoke-bad-sig-${Date.now()}`, body: 'hola' });
    const res = await postFirmado(cuerpo, { firmaValida: false });
    reportar('Firma inválida responde 401', res.status === 401, `status=${res.status}`);
  }

  // ── 3) Dedupe por wa_message_id ──────────────────────────────────────────
  {
    const waId = `wamid.smoke-dedupe-${Date.now()}`;
    const cuerpo = payloadMensaje({ from: TEST_PHONE_NO_AUTORIZADO, id: waId, body: 'hola, soy un duplicado' });
    const r1 = await postFirmado(cuerpo);
    const r2 = await postFirmado(cuerpo);
    const ambosOk = r1.status === 200 && r2.status === 200;
    const filas = await esperar(async () => {
      const [r] = await dbQuery(env, `select count(*) c from sgc.whatsapp_mensajes where wa_message_id = '${waId}'`);
      return Number(r.c) >= 1 ? r : null;
    });
    reportar('Webhook acusa 200 en ambos envíos', ambosOk, `status1=${r1.status} status2=${r2.status}`);
    reportar('Duplicado se procesa UNA sola vez (dedupe)', filas && Number(filas.c) === 1, `filas con ese wa_message_id=${filas?.c ?? '?'}`);
  }

  // ── 4) Número NO autorizado → no_autorizado, sin llamar a Claude ─────────
  {
    const waId = `wamid.smoke-no-autorizado-${Date.now()}`;
    const cuerpo = payloadMensaje({ from: TEST_PHONE_NO_AUTORIZADO, id: waId, body: '¿cuántos vehículos tenemos?' });
    await postFirmado(cuerpo);
    // OJO: la fila-claim del dedupe se inserta YA (estado='procesando') antes de
    // que EdgeRuntime.waitUntil termine de clasificarla — hay que esperar a que
    // deje ese estado transitorio, no solo a que "exista alguna fila".
    const fila = await esperar(async () => {
      const [r] = await dbQuery(env, `select estado from sgc.whatsapp_mensajes where wa_message_id = '${waId}'`);
      return r && r.estado !== 'procesando' ? r : null;
    });
    reportar('No autorizado queda registrado como tal', fila?.estado === 'no_autorizado', `estado=${fila?.estado ?? '(sin fila / aún procesando)'}`);
  }

  // ── 5) Número autorizado llega hasta `assistant` ─────────────────────────
  {
    const waId = `wamid.smoke-autorizado-${Date.now()}`;
    const cuerpo = payloadMensaje({ from: TEST_PHONE, id: waId, body: '¿qué puedo consultar?' });
    await postFirmado(cuerpo);
    const inbound = await esperar(async () => {
      const [r] = await dbQuery(env, `select estado, usuario_id from sgc.whatsapp_mensajes where wa_message_id = '${waId}'`);
      return r && r.estado !== 'procesando' ? r : null;
    });
    reportar('Autorizado: mensaje de entrada registrado con usuario resuelto', !!inbound?.usuario_id, `usuario_id=${inbound?.usuario_id ?? '(ninguno)'}`);

    const conv = await esperar(async () => {
      const [r] = await dbQuery(env, `select conversacion_id, aviso_primer_uso_en from sgc.whatsapp_conversaciones where telefono = '${TEST_PHONE}'`);
      return r?.conversacion_id ? r : null;
    }, { timeoutMs: 30000 });
    reportar('Compa respondió (conversacion_id asignado)', !!conv?.conversacion_id, `conversacion_id=${conv?.conversacion_id ?? '(ninguna)'}`);
    reportar('Aviso de primer uso quedó sellado (DC6)', !!conv?.aviso_primer_uso_en, `aviso_primer_uso_en=${conv?.aviso_primer_uso_en ?? '(sin sellar)'}`);

    const salidaFallida = await esperar(async () => {
      const [r] = await dbQuery(env, `select estado, error from sgc.whatsapp_mensajes where telefono = '${TEST_PHONE}' and direccion = 'salida' order by creado_en desc limit 1`);
      return r ?? null;
    });
    reportar(
      'Envío de salida falló de forma controlada (WHATSAPP_TOKEN aún es placeholder — esperado)',
      salidaFallida?.estado === 'fallido',
      `estado=${salidaFallida?.estado ?? '(sin fila)'} error="${(salidaFallida?.error ?? '').slice(0, 120)}"`,
    );
  }
} finally {
  // ── Cleanup (best-effort) ──────────────────────────────────────────────
  await dbQuery(env, `delete from sgc.whatsapp_mensajes where telefono in ('${TEST_PHONE}', '${TEST_PHONE_NO_AUTORIZADO}')`).catch(() => {});
  await dbQuery(env, `delete from sgc.whatsapp_conversaciones where telefono in ('${TEST_PHONE}', '${TEST_PHONE_NO_AUTORIZADO}')`).catch(() => {});
  await dbQuery(env, `delete from sgc.whatsapp_autorizados where telefono = '${TEST_PHONE}'`).catch(() => {});
}

const okCount = resultados.filter((r) => r.ok).length;
console.log(`\n${okCount}/${resultados.length} verificaciones OK.`);
if (okCount < resultados.length) process.exit(1);
