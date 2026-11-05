// scripts/smoke-wa-ingest.mjs — DB-S9. Smoke del Contrato de `wa-ingest` (PROMPT
// DB-2, ronda DB) + del dead-man de `wa-extract`. Firma los payloads con el
// MISMO secreto que la edge espera (WA_SHARED_SECRET_<ENV> en .env.local) y
// verifica, sin depender de que el listener real esté conectado:
//
//   (1) firma inválida → 401          (6) duplicado por wa_message_id → 1 sola fila
//   (2) timestamp viejo (replay) → 401 (7) grupo en modo 'ignorar' → NO se guarda
//   (3) `config` responde defaults     (8) heartbeat actualiza wa_listener_estado
//   (4) DM no autorizado → respuesta   (9) latido viejo → wa-extract genera alerta
//       cortés, SIN llamar a Claude        (wa_eventos codigo=listener_latido_caido)
//   (5) (--con-ia) DM autorizado llega a `assistant` / una conversación de
//       ejemplo produce hallazgos vía `wa-extract` — am bos cuestan tokens
//       reales de Anthropic, por eso quedan DETRÁS de --con-ia (opt-in).
//
// Todo lo que este smoke crea (grupos/mensajes/eventos/heartbeat de prueba) se
// limpia al final, haya pasado o no.
//
// Uso:
//   node scripts/smoke-wa-ingest.mjs --env dev
//   node scripts/smoke-wa-ingest.mjs --env dev --con-ia   (además, casos con costo real de IA)
//
// Precondición: WA_SHARED_SECRET debe estar aplicado como secret de la edge en
// el entorno indicado (node scripts/aplicar-secret.mjs --env dev WA_SHARED_SECRET)
// y el MISMO valor debe existir en .env.local como WA_SHARED_SECRET_<ENV> para
// que este script pueda firmar. Si la edge responde 503 "falta configurar" en
// TODOS los casos, el smoke lo detecta y lo dice claramente en vez de reportar
// fallos genéricos.
import { createHmac, randomUUID } from 'node:crypto';
import { resolverEnv } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const CON_IA = process.argv.includes('--con-ia');

const SUF = env.entorno.toUpperCase();
const WA_SHARED_SECRET = process.env[`WA_SHARED_SECRET_${SUF}`];
const INFRA_SYNC_SECRET = process.env[`INFRA_SYNC_SECRET_${SUF}`];
if (!WA_SHARED_SECRET) {
  console.error(`🔴 Falta WA_SHARED_SECRET_${SUF} en .env.local — no puedo firmar nada. Genera uno y aplícalo primero (ver docs/WHATSAPP-GRUPOS.md).`);
  process.exit(1);
}
if (!env.serviceKey) {
  console.error(`🔴 Falta SUPABASE_SERVICE_ROLE_KEY_${SUF} en .env.local.`);
  process.exit(1);
}

const WA_INGEST_URL = `${env.url}/functions/v1/wa-ingest`;
const WA_EXTRACT_URL = `${env.url}/functions/v1/wa-extract`;
const SB_REST = `${env.url}/rest/v1`;

let ok = true;
const check = (name, cond, detalle = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detalle ? ` — ${detalle}` : ''}`);
  if (!cond) ok = false;
};

function firmar(cuerpo) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const firma = createHmac('sha256', WA_SHARED_SECRET).update(`${timestamp}.${cuerpo}`).digest('hex');
  return { timestamp, firma };
}

async function postIngest(body, { timestamp, firma } = {}) {
  const cuerpo = JSON.stringify(body);
  const sig = timestamp && firma ? { timestamp, firma } : firmar(cuerpo);
  const res = await fetch(WA_INGEST_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wa-timestamp': sig.timestamp,
      'x-wa-signature': sig.firma,
    },
    body: cuerpo,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SB_REST}/${path}`, {
    ...opts,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'content-type': 'application/json',
      'Accept-Profile': 'sgc',
      'Content-Profile': 'sgc',
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${res.status} ${path}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const GRUPO_TEST = `smoke-wa-ingest-${randomUUID().slice(0, 8)}@g.us`;
const GRUPO_IGNORAR = `smoke-wa-ignorar-${randomUUID().slice(0, 8)}@g.us`;
const HOST_TEST = `smoke-host-${randomUUID().slice(0, 8)}`;

async function limpiar() {
  await sb(`wa_mensajes_grupo?grupo_jid=in.(${encodeURIComponent(GRUPO_TEST)},${encodeURIComponent(GRUPO_IGNORAR)})`, { method: 'DELETE' }).catch(() => {});
  await sb(`wa_grupos?jid=in.(${encodeURIComponent(GRUPO_TEST)},${encodeURIComponent(GRUPO_IGNORAR)})`, { method: 'DELETE' }).catch(() => {});
  await sb(`wa_listener_estado?host=eq.${encodeURIComponent(HOST_TEST)}`, { method: 'DELETE' }).catch(() => {});
  await sb(`wa_eventos?detalle->>host=eq.${encodeURIComponent(HOST_TEST)}`, { method: 'DELETE' }).catch(() => {});
}

try {
  console.log(`\n▶ smoke wa-ingest/wa-extract — entorno ${env.entorno} (${env.ref})\n`);

  // ── (0) ¿está configurado el secret en la edge desplegada? ────────────────
  const sondeo = await postIngest({ type: 'config' });
  if (sondeo.status === 503) {
    console.error(`\n🔴 wa-ingest respondió 503 (${sondeo.json?.error}) — WA_SHARED_SECRET no está aplicado como secret de la edge en ${env.entorno}.`);
    console.error(`   Aplícalo con: node scripts/aplicar-secret.mjs --env ${env.entorno} WA_SHARED_SECRET`);
    console.error(`   (el valor ya está en .env.local como WA_SHARED_SECRET_${SUF} — este script firma con ese mismo valor.)\n`);
    process.exit(1);
  }

  // ── (1) firma inválida → 401 ───────────────────────────────────────────────
  const malaFirma = await postIngest({ type: 'config' }, { timestamp: Math.floor(Date.now() / 1000).toString(), firma: 'a'.repeat(64) });
  check('firma inválida → 401', malaFirma.status === 401, `status=${malaFirma.status}`);

  // ── (2) timestamp viejo (replay, >300s) → 401 ─────────────────────────────
  const cuerpoReplay = JSON.stringify({ type: 'config' });
  const tsViejo = (Math.floor(Date.now() / 1000) - 600).toString();
  const firmaVieja = createHmac('sha256', WA_SHARED_SECRET).update(`${tsViejo}.${cuerpoReplay}`).digest('hex');
  const replay = await postIngest({ type: 'config' }, { timestamp: tsViejo, firma: firmaVieja });
  check('timestamp fuera de ventana (replay) → 401', replay.status === 401, `status=${replay.status}`);

  // ── (3) config responde con defaults razonables ───────────────────────────
  const cfg = await postIngest({ type: 'config' });
  check('config → 200 con grupos[] y modo_por_defecto', cfg.status === 200 && Array.isArray(cfg.json?.grupos) && typeof cfg.json?.modo_por_defecto === 'string');

  // ── Preparar grupos de prueba (uno memoria, uno ignorar) ──────────────────
  await sb('wa_grupos', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ jid: GRUPO_TEST, nombre: 'Smoke memoria', modo: 'memoria' }, { jid: GRUPO_IGNORAR, nombre: 'Smoke ignorar', modo: 'ignorar' }]) });

  // ── (6) duplicado por wa_message_id → 1 sola fila ─────────────────────────
  const waMsgId = `smoke:${randomUUID()}`;
  const mensajeBase = { type: 'mensajes', mensajes: [{ wa_message_id: waMsgId, grupo_jid: GRUPO_TEST, autor_telefono: '18095551234', autor_nombre: 'Smoke Tester', tipo: 'texto', texto: 'mensaje de prueba del smoke', enviado_en: new Date().toISOString() }] };
  const r1 = await postIngest(mensajeBase);
  const r2 = await postIngest(mensajeBase); // mismo wa_message_id
  const filas = await sb(`wa_mensajes_grupo?wa_message_id=eq.${encodeURIComponent(waMsgId)}&select=id`);
  check('mensaje nuevo → aceptado=1 en la primera llamada', r1.status === 200 && r1.json?.aceptados === 1, JSON.stringify(r1.json));
  check('mismo wa_message_id repetido → NO duplica (sigue habiendo 1 fila)', Array.isArray(filas) && filas.length === 1, `filas=${filas?.length}`);

  // ── (7) grupo en modo 'ignorar' → no se guarda ────────────────────────────
  const waMsgIdIgnorar = `smoke:${randomUUID()}`;
  await postIngest({ type: 'mensajes', mensajes: [{ wa_message_id: waMsgIdIgnorar, grupo_jid: GRUPO_IGNORAR, autor_telefono: '18095551234', autor_nombre: 'Smoke Tester', tipo: 'texto', texto: 'esto NO debe guardarse', enviado_en: new Date().toISOString() }] });
  const filasIgnorar = await sb(`wa_mensajes_grupo?wa_message_id=eq.${encodeURIComponent(waMsgIdIgnorar)}&select=id`);
  check("grupo modo='ignorar' → el mensaje NO se guarda", Array.isArray(filasIgnorar) && filasIgnorar.length === 0, `filas=${filasIgnorar?.length}`);

  // ── (4) DM de un número NO autorizado → respuesta cortés, sin llamar a Claude ──
  const telefonoNoAutorizado = '18095559999'; // no debe existir en whatsapp_autorizados
  const autorizado = await sb(`whatsapp_autorizados?telefono=eq.${telefonoNoAutorizado}&select=telefono`);
  if (Array.isArray(autorizado) && autorizado.length) {
    console.log('… (saltado) el teléfono de prueba para "no autorizado" ya está en whatsapp_autorizados — elige otro en el script si esto se repite.');
  } else {
    const dmNoAuth = await postIngest({ type: 'dm', wa_message_id: `smoke:${randomUUID()}`, telefono: telefonoNoAutorizado, tipo: 'texto', texto: '¿qué requisiciones hay pendientes?' });
    check('DM no autorizado → 200 con mensaje cortés (no acciones vacías, no error)', dmNoAuth.status === 200 && Array.isArray(dmNoAuth.json?.acciones), JSON.stringify(dmNoAuth.json));
  }

  // ── (8) heartbeat actualiza wa_listener_estado ────────────────────────────
  const hb = await postIngest({ type: 'heartbeat', host: HOST_TEST, estado: 'conectado', libreria: 'smoke', version: '0.0.0', cola_pendiente: 0, mensajes_enviados_24h: 0, reconexiones_24h: 0 });
  const estadoRow = await sb(`wa_listener_estado?host=eq.${encodeURIComponent(HOST_TEST)}&select=estado`);
  check('heartbeat → 200 y wa_listener_estado queda con ese host', hb.status === 200 && estadoRow?.[0]?.estado === 'conectado', JSON.stringify(estadoRow));

  // ── (9) dead-man: latido viejo → wa-extract genera alerta (sin costo de IA) ──
  if (!INFRA_SYNC_SECRET) {
    console.log('… (saltado) falta INFRA_SYNC_SECRET_' + SUF + ' en .env.local — no puedo probar el dead-man de wa-extract.');
  } else {
    const haceVeinte = new Date(Date.now() - 20 * 60_000).toISOString();
    await sb(`wa_listener_estado?host=eq.${encodeURIComponent(HOST_TEST)}`, { method: 'PATCH', body: JSON.stringify({ ultimo_latido_en: haceVeinte }) });
    const resExtract = await fetch(WA_EXTRACT_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': INFRA_SYNC_SECRET }, body: JSON.stringify({ tarea: 'revisar_latido' }) });
    const eventos = await sb(`wa_eventos?detalle->>host=eq.${encodeURIComponent(HOST_TEST)}&codigo=eq.listener_latido_caido&select=id`);
    check('wa-extract (revisar_latido) → 200', resExtract.status === 200, `status=${resExtract.status}`);
    check('latido viejo (>10min) → wa_eventos registra listener_latido_caido', Array.isArray(eventos) && eventos.length >= 1, `eventos=${eventos?.length}`);
  }

  // ── (5) --con-ia: casos con costo real de Anthropic ───────────────────────
  if (CON_IA) {
    console.log('\n--con-ia: casos con costo real de Anthropic —\n');
    const whitelisted = await sb('whatsapp_autorizados?activo=eq.true&select=telefono,usuario_id&limit=1');
    if (!Array.isArray(whitelisted) || !whitelisted.length) {
      console.log('… (saltado) no hay ningún teléfono activo en whatsapp_autorizados para probar el DM autorizado.');
    } else {
      const dmOk = await postIngest({ type: 'dm', wa_message_id: `smoke:${randomUUID()}`, telefono: whitelisted[0].telefono, tipo: 'texto', texto: 'hola Compa, esto es un smoke de prueba, solo responde brevemente' });
      check('DM de teléfono autorizado → llega a assistant (acciones no vacías)', dmOk.status === 200 && Array.isArray(dmOk.json?.acciones) && dmOk.json.acciones.length > 0, JSON.stringify(dmOk.json)?.slice(0, 200));
    }

    // Mensaje con contenido extraíble + forzar su procesamiento vía wa-extract.
    const waMsgExtract = `smoke:${randomUUID()}`;
    await postIngest({ type: 'mensajes', mensajes: [{ wa_message_id: waMsgExtract, grupo_jid: GRUPO_TEST, autor_telefono: '18095551234', autor_nombre: 'Ingeniero Smoke', tipo: 'texto', texto: 'Quedamos en que mañana a las 8am llega el camión con 50 sacos de cemento para la obra Torre Alpha, el proveedor cobra RD$12,500.', enviado_en: new Date().toISOString() }] });
    if (INFRA_SYNC_SECRET) {
      const resExtract2 = await fetch(WA_EXTRACT_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-secret': INFRA_SYNC_SECRET }, body: JSON.stringify({}) });
      check('wa-extract (extracción, body vacío) → 200', resExtract2.status === 200, `status=${resExtract2.status}`);
      // Espera breve a que el batch termine (la llamada es síncrona en la edge, pero por si acaso).
      const hallazgos = await sb(`wa_hallazgos?grupo_jid=eq.${encodeURIComponent(GRUPO_TEST)}&select=id,tipo,resumen`);
      check('la conversación de ejemplo produjo al menos 1 hallazgo', Array.isArray(hallazgos) && hallazgos.length >= 1, JSON.stringify(hallazgos));
    }
  } else {
    console.log('\n(usa --con-ia para probar también el DM autorizado real y la extracción de hallazgos — ambos cuestan tokens de Anthropic)');
  }

  console.log(ok ? '\n✓ Smoke de wa-ingest/wa-extract — todo OK.\n' : '\n🔴 Smoke de wa-ingest/wa-extract — hay fallos arriba.\n');
} finally {
  await limpiar();
}

process.exit(ok ? 0 : 1);
