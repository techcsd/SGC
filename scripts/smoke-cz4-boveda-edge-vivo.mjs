// smoke-cz4-boveda-edge-vivo.mjs — CZ3/CZ9. A diferencia de los smokes
// transaccionales (SQL puro), esto llama la edge `boveda` YA DESPLEGADA por
// HTTP real, con una sesión minteada por `admin/generate_link` (mismo patrón
// que compa-evals.mjs — nunca toca la contraseña real de nadie). Usa la
// cuenta "QA admin" (qa_admin@constructorasd.com, dev-only) para no arriesgar
// un bloqueo de 15 min en la cuenta real de Xaviel. Prueba RUTAS DE FALLO que
// no requieren conocer ninguna contraseña real: sin sesión, no-admin,
// contraseña incorrecta (sin llegar al límite de bloqueo), y que el gate de
// sesión-vigente niega el resto de acciones antes de abrir el Vault.
//
//   node scripts/smoke-cz4-boveda-edge-vivo.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 Este smoke solo corre contra dev (llama la edge real).'); process.exit(1); }

async function sesionDe(email) {
  const admin = await fetch(`${env.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await admin.json();
  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`No se pudo generar sesión para ${email}: ${JSON.stringify(link).slice(0, 300)}`);
  const vres = await fetch(`${env.url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: env.serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  const vj = await vres.json();
  if (!vj?.access_token) throw new Error(`No se pudo verificar sesión para ${email}: ${JSON.stringify(vj).slice(0, 300)}`);
  return vj.access_token;
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

function assert(cond, msg) {
  if (!cond) throw new Error('FALLO: ' + msg);
  console.log('OK:', msg);
}

try {
  // ── Setup: ids reales + limpiar cualquier residuo de corridas previas ──────
  const [[qaAdmin], [noAdmin]] = await Promise.all([
    dbQuery(env, `select u.id, u.email from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.email='qa_admin@constructorasd.com' limit 1`),
    dbQuery(env, `
      select u.id, u.email from sgc.usuarios u
      where exists (select 1 from sgc.usuarios_roles ur2 where ur2.usuario_id = u.id)
        and not exists (
          select 1 from sgc.usuarios_roles ur3 join sgc.roles r3 on r3.id = ur3.rol_id
          where ur3.usuario_id = u.id and r3.codigo in ('admin','subadmin')
        )
        and coalesce(u.activo, true)
      limit 1`),
  ]);
  if (!qaAdmin?.email) throw new Error('No existe qa_admin@constructorasd.com en este entorno.');
  if (!noAdmin?.email) throw new Error('No se encontró un usuario sin rol admin/subadmin para la prueba negativa.');

  await dbQuery(env, `delete from sgc.boveda_sesiones where usuario_id = '${qaAdmin.id}'::uuid`);
  await dbQuery(env, `delete from sgc.boveda_intentos where usuario_id = '${qaAdmin.id}'::uuid`);

  // ── #1 — sin Authorization: 401 ─────────────────────────────────────────
  const r1 = await fetch(`${env.url}/functions/v1/boveda`, {
    method: 'POST', headers: { apikey: env.serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'revelar', entrada_id: '00000000-0000-0000-0000-000000000000' }),
  });
  assert(r1.status === 401, `sin Authorization -> 401 (dio ${r1.status})`);

  // ── #2 — usuario SIN rol admin: 403, sin importar la acción ─────────────
  const tokenNoAdmin = await sesionDe(noAdmin.email);
  const r2 = await llamarBoveda(tokenNoAdmin, { accion: 'sesion_abrir', password: 'lo-que-sea' });
  assert(r2.status === 403, `usuario sin rol admin -> 403 incluso en sesion_abrir (dio ${r2.status}: ${JSON.stringify(r2.json)})`);

  // ── #3 — admin SIN sesión de Vault: cualquier acción != sesion_abrir -> 401 ──
  const tokenAdmin = await sesionDe(qaAdmin.email);
  const r3 = await llamarBoveda(tokenAdmin, { accion: 'revelar', entrada_id: '00000000-0000-0000-0000-000000000000' });
  assert(r3.status === 401 && r3.json?.error_code === 'sesion_vencida', `admin sin sesión de Vault -> 401 sesion_vencida (dio ${r3.status}: ${JSON.stringify(r3.json)})`);

  // ── #4 — admin, contraseña incorrecta (SIN llegar al límite de bloqueo) ──
  const r4 = await llamarBoveda(tokenAdmin, { accion: 'sesion_abrir', password: 'contraseña-definitivamente-incorrecta-cz4' });
  assert(r4.status === 401, `admin con contraseña incorrecta -> 401 (dio ${r4.status}: ${JSON.stringify(r4.json)})`);
  const [intento] = await dbQuery(env, `select fallos, bloqueado_hasta from sgc.boveda_intentos where usuario_id = '${qaAdmin.id}'::uuid`);
  assert(intento?.fallos === 1 && !intento.bloqueado_hasta, `el fallo quedó contado (1) sin bloquear todavía (dio ${JSON.stringify(intento)})`);

  const [acceso] = await dbQuery(env, `select accion from sgc.boveda_accesos where usuario_id = '${qaAdmin.id}'::uuid order by created_at desc limit 1`);
  assert(acceso?.accion === 'fallo_reautenticacion', `el fallo quedó auditado en boveda_accesos (dio ${JSON.stringify(acceso)})`);

  console.log('✓ CZ3/CZ9 boveda (edge real en dev): sin-auth=401, sin-rol-admin=403 (incl. sesion_abrir), sin-sesión-de-Vault=401/sesion_vencida, contraseña incorrecta=401+contada+auditada.');
} catch (e) {
  console.log('✗ smoke-cz4-boveda-edge-vivo falló:', e.message.slice(0, 2000));
  process.exitCode = 1;
} finally {
  // Limpieza: nunca dejar al QA admin con un fallo contado ni una sesión viva.
  try {
    const [qaAdmin] = await dbQuery(env, `select id from sgc.usuarios where email='qa_admin@constructorasd.com' limit 1`);
    if (qaAdmin?.id) {
      await dbQuery(env, `delete from sgc.boveda_intentos where usuario_id = '${qaAdmin.id}'::uuid`);
      await dbQuery(env, `delete from sgc.boveda_sesiones where usuario_id = '${qaAdmin.id}'::uuid`);
      await dbQuery(env, `delete from sgc.boveda_accesos where usuario_id = '${qaAdmin.id}'::uuid`);
    }
  } catch { /* best-effort */ }
}
