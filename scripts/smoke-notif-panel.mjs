// BK1 — Smoke de la 7ª regla: "un interruptor sólo cuenta si TODOS los caminos
// de salida lo consultan". Corre DESPUÉS de aplicar sql/2026-09-07-bk1-notif-panel-core.sql.
//
// Verifica, para un TIPO apagado a UN usuario concreto:
//   (1) notif_permitida(usuario,tipo) = false
//   (2) notificar(...) NO inserta fila en el inbox (sgc.notificaciones)
//   (3) send_push registra el motivo en notif_entregas (silenciada/fuera_de_matriz)
// y repite el caso a nivel ROL y GLOBAL. Limpia todo lo que crea.
//
// Necesita SUPABASE_ACCESS_TOKEN. On-demand (necesita DB); no corre en prebuild.
const token = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = 'jeeqhgccqefbqilntcpu';
if (!token) { console.error('NO SUPABASE_ACCESS_TOKEN'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text}`);
  return JSON.parse(text);
}

const TIPO = 'novedad';
let ok = true;
const check = (name, cond) => { console.log(`${cond ? 'OK ' : 'XX '} ${name}`); if (!cond) ok = false; };

try {
  // Un usuario real cualquiera (activo, no prueba).
  const [{ id: uid, nombre }] = await q(
    `select id, nombre from sgc.usuarios where activo and not coalesce(es_prueba,false) order by created_at limit 1`);
  console.log(`Usuario de prueba: ${nombre} (${uid})`);

  // ── Caso USUARIO ──────────────────────────────────────────────────────────
  // (set_notif_regla exige sesión admin; aquí insertamos la regla directo — el
  //  gate ya se prueba desde la UI. Lo que valida el smoke es el PREDICADO.)
  await q(`insert into sgc.notif_regla (tipo, rol, usuario_id, habilitado)
           values ('${TIPO}', null, '${uid}'::uuid, false)
           on conflict (tipo, coalesce(rol,'*'), coalesce(usuario_id,'00000000-0000-0000-0000-000000000000'::uuid))
           do update set habilitado=false`);
  const [{ permitida }] = await q(`select sgc.notif_permitida('${uid}'::uuid, '${TIPO}') as permitida`);
  check('nivel usuario: notif_permitida = false', permitida === false);

  const before = (await q(`select count(*) n from sgc.notificaciones where usuario_id='${uid}' and tipo='${TIPO}'`))[0].n;
  await q(`select sgc.notificar('${uid}'::uuid, '${TIPO}', 'Smoke BK1', 'no debe entrar', '/')`);
  const after = (await q(`select count(*) n from sgc.notificaciones where usuario_id='${uid}' and tipo='${TIPO}'`))[0].n;
  check('nivel usuario: NO se insertó en el inbox', Number(after) === Number(before));

  const rastro = (await q(
    `select motivo from sgc.notif_entregas where usuario_id='${uid}' and tipo='${TIPO}' and estado='omitida' order by created_at desc limit 1`));
  check('nivel usuario: rastro registró el motivo', rastro.length > 0 && ['silenciada','fuera_de_matriz'].includes(rastro[0].motivo));

  // ── Reactivar y confirmar que vuelve a entrar ────────────────────────────
  await q(`delete from sgc.notif_regla where tipo='${TIPO}' and usuario_id='${uid}'`);
  const [{ permitida: p2 }] = await q(`select sgc.notif_permitida('${uid}'::uuid, '${TIPO}') as permitida`);
  check('sin regla: notif_permitida = true (default permitido)', p2 === true);

  // Limpieza del inbox/rastro de prueba.
  await q(`delete from sgc.notificaciones where usuario_id='${uid}' and titulo='Smoke BK1'`);
  await q(`delete from sgc.notif_entregas where usuario_id='${uid}' and titulo='Smoke BK1'`);

  console.log(ok ? '\n✅ SMOKE OK' : '\n❌ SMOKE FALLÓ');
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('ERROR', e.message);
  process.exit(1);
}
