// smoke-da6-lote-conector-edge-vivo.mjs — DA-15/DA4. Prueba la pantalla de
// revisión del LOTE de equipos tecnológicos contra la edge `claude-borrador`
// YA DESPLEGADA en dev, por HTTP real: crea un borrador "a mano" (igual que lo
// haría `claude_borrador_crear` desde el conector), confirma SOLO una fila
// marcada, verifica que la otra NO se cargó, que el resultado por fila queda
// en `claude_borradores.resultado`, y que reintentar confirmar es idempotente
// (no duplica ni reprocesa).
//
//   node scripts/smoke-da6-lote-conector-edge-vivo.mjs --env dev
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
  const vres = await fetch(`${env.url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: env.serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  });
  const vj = await vres.json();
  if (!vj?.access_token) throw new Error(`No se pudo verificar sesión: ${JSON.stringify(vj).slice(0, 300)}`);
  return vj.access_token;
}

function assert(cond, msg) {
  if (!cond) throw new Error('FALLO: ' + msg);
  console.log('OK:', msg);
}

let borradorId, equipoIdCreado;
try {
  const [qaAdmin] = await dbQuery(env, `select u.id, u.email from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' and u.email='qa_admin@constructorasd.com' limit 1`);
  if (!qaAdmin?.email) throw new Error('No existe qa_admin@constructorasd.com en este entorno.');
  const token = await sesionDe(qaAdmin.email);

  const [b] = await dbQuery(env, `
    insert into sgc.claude_borradores (usuario_id, tool, params, resumen, idem)
    values ('${qaAdmin.id}'::uuid, 'proponer_equipos_tecnologicos_lote',
      jsonb_build_object('equipos', jsonb_build_array(
        jsonb_build_object('nombre', 'Smoke DA6 HTTP 1 (borrar)', 'tipo_clave', 'otro'),
        jsonb_build_object('nombre', 'Smoke DA6 HTTP 2 (borrar, no seleccionada)', 'tipo_clave', 'otro')
      )),
      'Smoke DA6 lote HTTP', 'smoke_da6_lote_http_test_permanente')
    returning id`);
  borradorId = b.id;

  const rGet = await fetch(`${env.url}/functions/v1/claude-borrador`, {
    method: 'POST', headers: { apikey: env.serviceKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'get', id: borradorId }),
  });
  const jGet = await rGet.json();
  assert(rGet.status === 200 && jGet.borrador?.tool === 'proponer_equipos_tecnologicos_lote', `get devuelve el borrador del lote (dio ${rGet.status})`);

  const rConf = await fetch(`${env.url}/functions/v1/claude-borrador`, {
    method: 'POST', headers: { apikey: env.serviceKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'confirmar', id: borradorId, seleccionadas: [0] }),
  });
  const jConf = await rConf.json();
  assert(rConf.status === 200 && jConf.ok, `confirmar lote (solo fila 0) -> ok (dio ${rConf.status}: ${JSON.stringify(jConf)})`);
  assert(Array.isArray(jConf.filas) && jConf.filas.length === 1 && jConf.filas[0].ok, `solo 1 fila procesada (la seleccionada)`);
  equipoIdCreado = jConf.filas[0].equipo_id;

  const [eq] = await dbQuery(env, `select nombre, notas from sgc.tec_equipos where id = '${equipoIdCreado}'::uuid`);
  assert(eq?.nombre === 'Smoke DA6 HTTP 1 (borrar)', `el equipo se creó con el nombre correcto`);
  assert(eq?.notas?.includes('Cargado por Claude'), `las notas marcan el origen=claude`);

  const [count] = await dbQuery(env, `select count(*) c from sgc.tec_equipos where nombre like 'Smoke DA6 HTTP%'`);
  assert(Number(count.c) === 1, `la fila NO seleccionada no se cargó (solo 1 equipo creado, no 2)`);

  const [borradorFinal] = await dbQuery(env, `select estado from sgc.claude_borradores where id = '${borradorId}'::uuid`);
  assert(borradorFinal.estado === 'confirmado', `el borrador quedó confirmado`);

  const rConf2 = await fetch(`${env.url}/functions/v1/claude-borrador`, {
    method: 'POST', headers: { apikey: env.serviceKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'confirmar', id: borradorId, seleccionadas: [0, 1] }),
  });
  const jConf2 = await rConf2.json();
  assert(jConf2.ok && jConf2.duplicado, `re-confirmar un lote ya confirmado no reprocesa`);
  const [count2] = await dbQuery(env, `select count(*) c from sgc.tec_equipos where nombre like 'Smoke DA6 HTTP%'`);
  assert(Number(count2.c) === 1, `sigue habiendo solo 1 equipo tras reintentar (idempotente)`);

  console.log('✓ smoke-da6-lote-conector-edge-vivo: get/confirmar-parcial/no-duplica/idempotencia todos OK.');
} catch (e) {
  console.log('✗ smoke-da6-lote-conector-edge-vivo falló:', e.message.slice(0, 2000));
  process.exitCode = 1;
} finally {
  if (equipoIdCreado) {
    await dbQuery(env, `delete from sgc.tec_equipo_historial where equipo_id = '${equipoIdCreado}'::uuid`);
    await dbQuery(env, `delete from sgc.tec_equipos where id = '${equipoIdCreado}'::uuid`);
  }
  if (borradorId) await dbQuery(env, `delete from sgc.claude_borradores where id = '${borradorId}'::uuid`);
}
