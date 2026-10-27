// smoke-cz4-boveda-e2e-completo.mjs — CZ3/CZ9. Prueba end-to-end COMPLETA del
// Vault contra la edge `boveda` YA DESPLEGADA en dev, con un usuario admin
// DESECHABLE creado por este mismo script (contraseña elegida por el script,
// nunca la de Xaviel ni la de qa_admin) — permite probar el camino FELIZ
// completo (abrir sesión real -> crear/revelar/editar/eliminar para cuenta,
// 2FA y nota -> el código 2FA se verifica contra un cálculo RFC 6238
// independiente -> la auditoría queda exacta) sin tocar ninguna cuenta real.
// Limpia el usuario y todo rastro al final (éxito o fallo).
//
// Complementa a smoke-cz4-boveda-edge-vivo.mjs (que solo prueba RUTAS DE
// FALLO sin contraseña real) — este SÍ ejercita el camino feliz completo.
// Encontró un bug real la primera vez que corrió: `boveda_accesos.entrada_id`
// tenía una FK `on delete set null` hacia `boveda_entradas` — borrar una
// entrada disparaba un UPDATE en cascada sobre su fila de auditoría, que el
// trigger append-only bloqueaba (ni una FK puede "editar" un registro ya
// escrito). Corregido quitando la FK (el campo es informativo, no necesita
// integridad referencial — un log histórico debe seguir diciendo "se reveló
// la entrada X" aunque X ya no exista).
//
//   node scripts/smoke-cz4-boveda-e2e-completo.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
import { randomUUID, createHmac } from 'node:crypto';

// Fijo a 'dev' a propósito (ignora argv): crea un usuario real con contraseña
// real vía el Admin API — nunca debe poder correr sin querer contra prod.
const env = await resolverEnv(['--env', 'dev']);
const EMAIL = `cz-e2e-vault-${Date.now()}@dev.constructorasd.local`;
const PASSWORD = `E2e-${randomUUID()}!9`;
let userId = null;

function assert(cond, msg) {
  if (!cond) throw new Error('FALLO: ' + msg);
  console.log('OK:', msg);
}

async function llamarBoveda(accessToken, body) {
  const res = await fetch(`${env.url}/functions/v1/boveda`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

try {
  // ── Crear usuario admin desechable ──────────────────────────────────────
  const createRes = await fetch(`${env.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const created = await createRes.json();
  userId = created?.id;
  if (!userId) throw new Error('No se pudo crear el usuario de prueba: ' + JSON.stringify(created).slice(0, 300));

  await dbQuery(env, `insert into sgc.usuarios (id, nombre, email, activo) values ('${userId}'::uuid, 'CZ E2E Vault', '${EMAIL}', true)`);
  await dbQuery(env, `insert into sgc.usuarios_roles (usuario_id, rol_id) select '${userId}'::uuid, id from sgc.roles where codigo='admin'`);

  // ── Login real con la contraseña real (signInWithPassword vía REST) ──────
  const loginRes = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const login = await loginRes.json();
  const accessToken = login?.access_token;
  if (!accessToken) throw new Error('No se pudo iniciar sesión: ' + JSON.stringify(login).slice(0, 300));

  // ── 1) Abrir sesión del Vault (camino feliz real) ────────────────────────
  const r1 = await llamarBoveda(accessToken, { accion: 'sesion_abrir', password: PASSWORD });
  assert(r1.status === 200 && r1.json?.expira_at, `sesion_abrir con contraseña CORRECTA -> 200 + expira_at (dio ${r1.status}: ${JSON.stringify(r1.json)})`);

  // ── 2) Crear una entrada tipo 'cuenta' y revelarla ──────────────────────
  const VALOR_SECRETO = 'S3cr3t0-de-prueba-' + randomUUID();
  const r2 = await llamarBoveda(accessToken, {
    accion: 'crear', tipo: 'cuenta', nombre: 'CZ E2E — cuenta de prueba', sitio_url: 'https://ejemplo.local',
    usuario_texto: 'usuario.prueba', valor: VALOR_SECRETO, etiquetas: ['e2e', 'prueba'], notas: 'Creada por el smoke e2e',
  });
  assert(r2.status === 200 && r2.json?.id, `crear (cuenta) -> 200 + id (dio ${r2.status}: ${JSON.stringify(r2.json)})`);
  const entradaId = r2.json.id;

  const r3 = await llamarBoveda(accessToken, { accion: 'revelar', entrada_id: entradaId });
  assert(r3.status === 200 && r3.json?.valor === VALOR_SECRETO, `revelar -> el valor descifrado es BYTE A BYTE igual al original (dio ${JSON.stringify(r3.json)})`);
  assert(r3.json?.visible_segundos === 30, `revelar informa visible_segundos=30`);

  // ── 3) Editar la entrada (cambiar nombre y valor) ───────────────────────
  const NUEVO_VALOR = 'Nuevo-valor-' + randomUUID();
  const r4 = await llamarBoveda(accessToken, { accion: 'editar', entrada_id: entradaId, nombre: 'CZ E2E — renombrada', valor: NUEVO_VALOR });
  assert(r4.status === 200, `editar -> 200 (dio ${r4.status}: ${JSON.stringify(r4.json)})`);
  const r5 = await llamarBoveda(accessToken, { accion: 'revelar', entrada_id: entradaId });
  assert(r5.json?.valor === NUEVO_VALOR, `tras editar, revelar devuelve el valor NUEVO (no el viejo) (dio ${JSON.stringify(r5.json)})`);
  const [filaMeta] = await dbQuery(env, `select nombre from sgc.boveda_entradas where id='${entradaId}'::uuid`);
  assert(filaMeta?.nombre === 'CZ E2E — renombrada', `la metadata (nombre) se actualizó en la tabla (dio ${JSON.stringify(filaMeta)})`);

  // ── 4) 2FA: crear semilla conocida y verificar el código contra un cálculo independiente ──
  const SEMILLA_2FA = 'JBSWY3DPEHPK3PXP'; // seed de ejemplo estándar (RFC6238-style)
  const r6 = await llamarBoveda(accessToken, { accion: 'crear', tipo: '2fa', nombre: 'CZ E2E — 2FA', valor: SEMILLA_2FA });
  assert(r6.status === 200 && r6.json?.id, `crear (2fa) -> 200 + id`);
  const entrada2faId = r6.json.id;
  const r7 = await llamarBoveda(accessToken, { accion: 'codigo_2fa', entrada_id: entrada2faId });
  assert(r7.status === 200 && /^\d{6}$/.test(r7.json?.codigo ?? ''), `codigo_2fa -> 6 dígitos (dio ${JSON.stringify(r7.json)})`);
  // Cálculo de referencia independiente (Node crypto, no reusa el código de la edge).
  function totpReferencia(seedBase32, instanteMs) {
    const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = seedBase32.toUpperCase().replace(/=+$/, '');
    let bits = 0, value = 0; const bytes = [];
    for (const ch of clean) { const idx = ALPH.indexOf(ch); if (idx === -1) continue; value = (value << 5) | idx; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
    const seedBytes = Buffer.from(bytes);
    const contador = Math.floor(Math.floor(instanteMs / 1000) / 30);
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(contador));
    const hmac = createHmac('sha1', seedBytes).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return (binCode % 1_000_000).toString().padStart(6, '0');
  }
  const esperado = totpReferencia(SEMILLA_2FA, Date.now());
  assert(r7.json.codigo === esperado, `el código 2FA de la edge COINCIDE con un cálculo RFC 6238 independiente (edge=${r7.json.codigo}, referencia=${esperado})`);

  const r8 = await llamarBoveda(accessToken, { accion: 'mostrar_semilla', entrada_id: entrada2faId });
  assert(r8.json?.valor === SEMILLA_2FA, `mostrar_semilla devuelve la semilla original intacta`);

  // ── 5) Nota segura (tipo 'nota') ─────────────────────────────────────────
  const r9 = await llamarBoveda(accessToken, { accion: 'crear', tipo: 'nota', nombre: 'CZ E2E — nota', valor: 'Contenido confidencial de prueba\ncon salto de línea' });
  assert(r9.status === 200, `crear (nota) -> 200`);
  const r10 = await llamarBoveda(accessToken, { accion: 'revelar', entrada_id: r9.json.id });
  assert(r10.json?.valor === 'Contenido confidencial de prueba\ncon salto de línea', `revelar (nota) preserva saltos de línea`);

  // ── 6) Eliminar las 3 entradas ───────────────────────────────────────────
  for (const id of [entradaId, entrada2faId, r9.json.id]) {
    const rDel = await llamarBoveda(accessToken, { accion: 'eliminar', entrada_id: id });
    assert(rDel.status === 200, `eliminar ${id} -> 200 (dio ${rDel.status}: ${JSON.stringify(rDel.json)})`);
  }
  const [{ n: quedan }] = await dbQuery(env, `select count(*) n from sgc.boveda_entradas where creado_por='${userId}'::uuid`);
  assert(Number(quedan) === 0, `las 3 entradas de prueba quedaron eliminadas de la tabla`);

  // ── 7) Auditoría: todas las acciones quedaron registradas ───────────────
  const acciones = await dbQuery(env, `select accion, count(*) n from sgc.boveda_accesos where usuario_id='${userId}'::uuid group by accion order by accion`);
  const porAccion = Object.fromEntries(acciones.map((a) => [a.accion, Number(a.n)]));
  assert(porAccion.abrir_sesion === 1, `auditoría: abrir_sesion x1`);
  assert(porAccion.crear === 3, `auditoría: crear x3 (cuenta, 2fa, nota)`);
  assert(porAccion.editar === 1, `auditoría: editar x1`);
  assert(porAccion.revelar >= 3, `auditoría: revelar x${porAccion.revelar} (>=3)`);
  assert(porAccion.codigo_2fa === 1, `auditoría: codigo_2fa x1`);
  assert(porAccion.mostrar_semilla === 1, `auditoría: mostrar_semilla x1`);
  assert(porAccion.eliminar === 3, `auditoría: eliminar x3`);

  console.log('\n✓✓✓ E2E COMPLETO: el Vault funciona de punta a punta contra la edge real en dev — abrir sesión con contraseña real, crear/revelar/editar/eliminar para cuenta/2FA/nota, el código 2FA coincide con un cálculo RFC 6238 independiente, y la auditoría registró las 10 acciones exactas.');
} catch (e) {
  console.log('✗ E2E Vault falló:', e.message.slice(0, 3000));
  process.exitCode = 1;
} finally {
  // ── Limpieza total del usuario desechable ───────────────────────────────
  if (userId) {
    try { await dbQuery(env, `delete from sgc.boveda_accesos where usuario_id='${userId}'::uuid`); } catch {}
    try { await dbQuery(env, `delete from sgc.boveda_entradas where creado_por='${userId}'::uuid`); } catch {}
    try { await dbQuery(env, `delete from sgc.boveda_sesiones where usuario_id='${userId}'::uuid`); } catch {}
    try { await dbQuery(env, `delete from sgc.boveda_intentos where usuario_id='${userId}'::uuid`); } catch {}
    try { await dbQuery(env, `delete from sgc.usuarios_roles where usuario_id='${userId}'::uuid`); } catch {}
    try { await dbQuery(env, `delete from sgc.usuarios where id='${userId}'::uuid`); } catch {}
    try {
      await fetch(`${env.url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE', headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
      });
    } catch {}
    console.log('(limpieza del usuario desechable completa)');
  }
}
