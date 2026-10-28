// smoke-da4-claves-equipo-edge-vivo.mjs — DA4/DA6. Prueba la edge
// `equipos-clave` YA DESPLEGADA en dev por HTTP real (mismo patrón que
// smoke-cz4-boveda-edge-vivo.mjs): sesión minteada con admin/generate_link
// para qa_admin@constructorasd.com, nunca una contraseña real. Ejercita el
// camino feliz completo (guardar → ver → quitar) con un valor de PRUEBA — la
// clave real del equipo 02 (1289) NUNCA se escribe aquí ni en ningún commit.
//
//   node scripts/smoke-da4-claves-equipo-edge-vivo.mjs --env dev
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

async function llamarEdge(accessToken, body) {
  const res = await fetch(`${env.url}/functions/v1/equipos-clave`, {
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

let equipoId;
try {
  const [qaAdmin] = await dbQuery(env, `select u.id, u.email from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.email='qa_admin@constructorasd.com' limit 1`);
  if (!qaAdmin?.email) throw new Error('No existe qa_admin@constructorasd.com en este entorno.');
  const [noAdmin] = await dbQuery(env, `
    select u.id, u.email from sgc.usuarios u
    where exists (select 1 from sgc.usuarios_roles ur2 where ur2.usuario_id = u.id)
      and not exists (
        select 1 from sgc.usuarios_roles ur3 join sgc.roles r3 on r3.id = ur3.rol_id
        where ur3.usuario_id = u.id and r3.codigo in ('admin', 'subadmin')
      )
      and coalesce(u.activo, true)
    limit 1`);
  if (!noAdmin?.email) throw new Error('No se encontró un usuario sin rol admin/subadmin para la prueba negativa.');

  const [eq] = await dbQuery(env, `insert into sgc.tec_equipos (nombre, tipo, estado) values ('Smoke DA4 (borrar)', 'otro', 'en_stock') returning id`);
  equipoId = eq.id;

  const r1 = await fetch(`${env.url}/functions/v1/equipos-clave`, {
    method: 'POST', headers: { apikey: env.serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'ver', equipo_id: equipoId }),
  });
  assert(r1.status === 401, `sin Authorization -> 401 (dio ${r1.status})`);

  const tokenNoAdmin = await sesionDe(noAdmin.email);
  const r2 = await llamarEdge(tokenNoAdmin, { accion: 'ver', equipo_id: equipoId });
  assert(r2.status === 403, `usuario sin permiso 'tecnologia.claves_equipos' -> 403 (dio ${r2.status}: ${JSON.stringify(r2.json)})`);

  const tokenAdmin = await sesionDe(qaAdmin.email);
  const r3 = await llamarEdge(tokenAdmin, { accion: 'ver', equipo_id: equipoId });
  assert(r3.status === 404, `admin, equipo sin clave guardada -> 404 (dio ${r3.status}: ${JSON.stringify(r3.json)})`);

  const valorPrueba = `smoke-valor-de-prueba-${Date.now()}`;
  const r4 = await llamarEdge(tokenAdmin, { accion: 'guardar', equipo_id: equipoId, tipo_clave: 'compartida', valor: valorPrueba });
  assert(r4.status === 200 && r4.json?.ok, `guardar clave de prueba -> ok (dio ${r4.status}: ${JSON.stringify(r4.json)})`);

  const r5 = await llamarEdge(tokenAdmin, { accion: 'ver', equipo_id: equipoId });
  assert(r5.status === 200 && r5.json?.valor === valorPrueba, `ver devuelve el valor descifrado correctamente (dio ${JSON.stringify(r5.json)})`);

  const [row] = await dbQuery(env, `select valor_cifrado, (select tiene_clave from sgc.tec_equipos where id='${equipoId}'::uuid) as tiene_clave from sgc.tec_equipo_claves where equipo_id = '${equipoId}'::uuid`);
  assert(row?.valor_cifrado && row.valor_cifrado !== valorPrueba, `el valor en la tabla está cifrado, no en claro`);
  assert(row?.tiene_clave === true, `la bandera no-secreta tec_equipos.tiene_clave se puso en true`);

  const histRows = await dbQuery(env, `select descripcion from sgc.tec_equipo_historial where equipo_id = '${equipoId}'::uuid and tipo_cambio = 'clave' order by created_at`);
  assert(histRows.length === 2, `2 filas de historial (guardar+ver), dio ${histRows.length}`);
  assert(!histRows.some((h) => h.descripcion?.includes(valorPrueba)), `el historial NUNCA contiene el valor de la clave`);

  const r6 = await llamarEdge(tokenAdmin, { accion: 'quitar', equipo_id: equipoId });
  assert(r6.status === 200 && r6.json?.ok, `quitar clave -> ok (dio ${r6.status}: ${JSON.stringify(r6.json)})`);
  const r7 = await llamarEdge(tokenAdmin, { accion: 'ver', equipo_id: equipoId });
  assert(r7.status === 404, `ver después de quitar -> 404 (dio ${r7.status})`);
  const [eqFinal] = await dbQuery(env, `select tiene_clave from sgc.tec_equipos where id = '${equipoId}'::uuid`);
  assert(eqFinal?.tiene_clave === false, `tiene_clave vuelve a false tras quitar`);

  console.log('✓ smoke-da4-claves-equipo-edge-vivo: todos los asserts OK.');
} catch (e) {
  console.log('✗ smoke-da4-claves-equipo-edge-vivo falló:', e.message.slice(0, 2000));
  process.exitCode = 1;
} finally {
  if (equipoId) {
    await dbQuery(env, `delete from sgc.tec_equipo_claves where equipo_id = '${equipoId}'::uuid`);
    await dbQuery(env, `delete from sgc.tec_equipo_historial where equipo_id = '${equipoId}'::uuid`);
    await dbQuery(env, `delete from sgc.tec_equipos where id = '${equipoId}'::uuid`);
  }
}
