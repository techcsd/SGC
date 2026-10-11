// qa/cm4-conduce-fase.smoke.mjs — CANDADO CM4 (regla: toda migración que toque
// `conduce_fase` corre este smoke antes de aplicarse).
//
// Verifica la matriz {sin receptor, con receptor} × {emitido, en_transito, entregando,
// entregado, confirmado} → fase esperada + conduce_puede_transferir esperado. Todo en una
// transacción que hace ROLLBACK (raise al final): no deja datos.
//
//   node qa/cm4-conduce-fase.smoke.mjs --env dev
import '../scripts/lib/load-env.mjs';
import { resolverEnv, dbQuery } from '../scripts/lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const bodega = (await dbQuery(env, `select id from sgc.bodegas limit 1`))?.[0]?.id;
const admin = (await dbQuery(env, `select u.id from sgc.usuarios u join sgc.usuarios_roles ur on ur.usuario_id=u.id join sgc.roles r on r.id=ur.rol_id where r.nombre ilike '%admin%' and u.activo limit 1`))?.[0]?.id;
if (!bodega || !admin) { console.error('🔴 No hay bodega/admin para el smoke'); process.exit(1); }

// casos: [label, setSQL, faseEsperada, puedeEsperado]
const base = `firma_pendiente_usuario_id=null, transito_at=null, entregando_at=null, recibido_por=null, estado='despachado'`;
const casos = [
  ['sinR/emitido',    base, 'emitido', true],
  ['conR/emitido',    `firma_pendiente_usuario_id='${admin}', transito_at=null, entregando_at=null, recibido_por=null, estado='despachado'`, 'emitido', true],
  ['conR/en_transito',`firma_pendiente_usuario_id='${admin}', transito_at=now(), entregando_at=null, recibido_por=null, estado='despachado'`, 'en_transito', true],
  ['conR/entregando', `firma_pendiente_usuario_id='${admin}', transito_at=now(), entregando_at=now(), recibido_por=null, estado='despachado'`, 'pendiente_firma', false],
  ['sinR/entregado',  `firma_pendiente_usuario_id=null, transito_at=now(), entregando_at=null, recibido_por=null, estado='entregado'`, 'entregado', false],
  ['conR/entregado',  `firma_pendiente_usuario_id='${admin}', transito_at=now(), entregando_at=null, recibido_por=null, estado='entregado'`, 'pendiente_firma', false],
  ['confirmado',      `firma_pendiente_usuario_id=null, transito_at=now(), entregando_at=null, recibido_por='${admin}', estado='entregado'`, 'confirmado', false],
];

const checks = casos.map(([label, set, fase, puede]) => `
  update sgc.salidas_inventario set ${set} where id=v_id;
  v_fase:=sgc.conduce_fase(v_id); v_puede:=(sgc.conduce_puede_transferir(v_id)->>'puede')::boolean;
  if v_fase<>'${fase}' or v_puede<>${puede} then v_fail:=v_fail||format('[${label} fase=%s(esp ${fase}) puede=%s(esp ${puede})] ',v_fase,v_puede); end if;`).join('\n');

const sql = `do $$
declare v_id uuid; v_fase text; v_puede boolean; v_fail text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub','${admin}','role','authenticated')::text, true);
  insert into sgc.salidas_inventario (fecha, bodega_id, creado_por, estado)
    values (current_date, '${bodega}', '${admin}', 'despachado') returning id into v_id;
  ${checks}
  if v_fail<>'' then raise exception 'SMOKE CM4 FALLÓ: %', v_fail; end if;
  raise exception '__OK__';
end $$;`;

try {
  await dbQuery(env, sql);
  console.error('🔴 El smoke no hizo rollback (inesperado)'); process.exit(1);
} catch (e) {
  const msg = String(e.message || e);
  if (msg.includes('__OK__')) { console.log('✓ SMOKE CM4 OK — matriz receptor×fase correcta (rollback).'); process.exit(0); }
  console.error('🔴 ' + msg); process.exit(1);
}
