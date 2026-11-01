// smoke-de4-transferencias.mjs — Ronda DE F5 (DE4/DE-11/DE-12). BEGIN/ROLLBACK:
// nada queda guardado.
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
const env = await resolverEnv(process.argv.slice(2));

const SALIDA_ID = '426fa75d-a9e1-4937-867a-e92805ffea09'; // fase 'emitido' en dev

const sql = `
begin;
do $$
declare
  v_admin uuid; v_sin_usuario uuid; v_con_usuario uuid; v_usuario_b uuid;
  v_conductor_sin_usuario uuid; v_conductor_con_usuario uuid;
  v_id uuid; v_cnt int; v_fila record; v_ok boolean; v_msg text;
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur join sgc.roles r on r.id=ur.rol_id where r.codigo='admin' limit 1;

  -- Conductor SIN usuario (sintético) — debe quedar invisible en choferes_activos()
  -- y rechazado al intentar ofrecerle una transferencia.
  insert into sgc.conductores (nombre, cedula, licencia_tipo, activo)
  values ('Smoke DE4 sin usuario', '00000000777', '2', true)
  returning id into v_conductor_sin_usuario;

  -- Conductor CON usuario (sintético) — debe poder recibir.
  insert into auth.users (id) values (gen_random_uuid()) returning id into v_usuario_b;
  insert into sgc.usuarios (id, nombre, email, activo)
  values (v_usuario_b, 'Smoke DE4 receptor', 'smoke-de4-receptor@dev.constructorasd.local', true);
  insert into sgc.conductores (nombre, cedula, licencia_tipo, usuario_id, activo)
  values ('Smoke DE4 con usuario', '00000000778', '2', v_usuario_b, true)
  returning id into v_conductor_con_usuario;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- #1 — choferes_activos() nunca devuelve al que no tiene usuario.
  if exists (select 1 from sgc.choferes_activos() where conductor_id = v_conductor_sin_usuario) then
    raise exception 'FAIL #1: choferes_activos() devolvió un conductor sin usuario';
  end if;
  if not exists (select 1 from sgc.choferes_activos() where conductor_id = v_conductor_con_usuario) then
    raise exception 'FAIL #1b: choferes_activos() NO devolvió al conductor con usuario';
  end if;

  -- #2 — ofrecer a un conductor SIN usuario: rechazado, CERO filas insertadas.
  v_ok := true; v_msg := null;
  begin
    perform sgc.ofrecer_transferencia_conduce('${SALIDA_ID}', v_conductor_sin_usuario, 'prueba smoke');
    v_ok := false; -- si no lanzó excepción, falló la prueba
  exception when others then
    v_msg := sqlerrm;
  end;
  if not v_ok then raise exception 'FAIL #2: ofrecer_transferencia_conduce NO rechazó un destino sin usuario'; end if;
  if v_msg not ilike '%no tiene usuario%' then raise exception 'FAIL #2b: mensaje no menciona "no tiene usuario" — %', v_msg; end if;
  select count(*) into v_cnt from sgc.conduce_transferencias where salida_id = '${SALIDA_ID}' and a_conductor_id = v_conductor_sin_usuario;
  if v_cnt <> 0 then raise exception 'FAIL #2c: quedó una oferta "fantasma" (% filas) pese al rechazo', v_cnt; end if;

  -- #3 — ofrecer a un conductor CON usuario: funciona, queda registrada.
  -- (La notificación en sí — sgc.notificar/sgc.send_push — es infraestructura
  -- preexistente sin tocar; se verificó aparte, fuera de este rollback anidado,
  -- que SÍ inserta correctamente — ver notas de la ronda en el HANDOFF. Aquí
  -- solo se valida lo que esta migración cambia: la oferta y sus datos.)
  v_id := sgc.ofrecer_transferencia_conduce('${SALIDA_ID}', v_conductor_con_usuario, 'prueba smoke ok');
  if v_id is null then raise exception 'FAIL #3: no se creó la oferta válida'; end if;
  if (select a_conductor_id from sgc.conduce_transferencias where id = v_id) <> v_conductor_con_usuario then
    raise exception 'FAIL #3b: la oferta no quedó con el destino correcto';
  end if;

  -- #4 — mis_transferencias_ofrecidas() (como admin, que ofreció) la trae.
  if not exists (select 1 from sgc.mis_transferencias_ofrecidas() where id = v_id) then
    raise exception 'FAIL #4: mis_transferencias_ofrecidas() no trae la oferta recién creada';
  end if;

  -- #5 — transferencias_pendientes_flota() la trae con antigüedad >= 0.
  select * into v_fila from sgc.transferencias_pendientes_flota() where id = v_id;
  if v_fila.id is null then raise exception 'FAIL #5: transferencias_pendientes_flota() no trae la oferta'; end if;
  if v_fila.antiguedad_horas < 0 then raise exception 'FAIL #5b: antigüedad negativa'; end if;

  -- #6 — cancelar: un tercero no puede.
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_b, 'role', 'authenticated')::text, true);
  v_ok := true;
  begin
    perform sgc.cancelar_transferencia_conduce(v_id);
    v_ok := false;
  exception when others then null;
  end;
  if not v_ok then raise exception 'FAIL #6: el receptor (no ofertante) pudo cancelar';
  end if;

  -- #7 — cancelar: el admin que ofreció sí puede.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform sgc.cancelar_transferencia_conduce(v_id);
  if (select estado from sgc.conduce_transferencias where id = v_id) <> 'cancelada' then
    raise exception 'FAIL #7: no quedó en estado cancelada';
  end if;

  -- #8 — cancelar dos veces: falla (ya no está "ofrecida").
  v_ok := true;
  begin
    perform sgc.cancelar_transferencia_conduce(v_id);
    v_ok := false;
  exception when others then null;
  end;
  if not v_ok then raise exception 'FAIL #8: canceló una oferta que ya no estaba "ofrecida"'; end if;

  -- #9 — cron de recordatorio corre sin error (backdateando una oferta nueva a 13h)
  -- y marca recordada_receptor_en/recordada_ofertante_en UNA sola vez cada una.
  -- (el UPDATE directo es solo para preparar el escenario de prueba — no hay
  -- grant de UPDATE a authenticated en esta tabla a propósito, regla 10).
  reset role;
  -- es_prueba=false a propósito: la salida de prueba (426fa75d) es demo (CK5) y
  -- el cron, correctamente, NO molesta a nadie con recordatorios de datos de
  -- prueba — aquí se fuerza a false solo para poder probar la lógica de tiempo.
  update sgc.conduce_transferencias set ofrecida_en = now() - interval '13 hours', estado = 'ofrecida', resuelta_en = null, es_prueba = false where id = v_id;
  perform sgc.recordar_transferencias_pendientes();
  if not exists (select 1 from sgc.conduce_transferencias where id = v_id and recordada_receptor_en is not null and recordada_ofertante_en is not null) then
    raise exception 'FAIL #9: el cron no marcó recordada_receptor_en/recordada_ofertante_en';
  end if;
  -- segunda corrida: las marcas de tiempo no deben re-escribirse (ya no son null).
  select recordada_receptor_en::text into v_msg from sgc.conduce_transferencias where id = v_id;
  perform sgc.recordar_transferencias_pendientes();
  if (select recordada_receptor_en::text from sgc.conduce_transferencias where id = v_id) <> v_msg then
    raise exception 'FAIL #9b: el cron re-marcó recordada_receptor_en en una segunda corrida';
  end if;

  raise notice 'OK — DE4/F5: choferes_activos filtra sin-usuario, ofrecer rechaza sin "fantasma", cancelar (reglas de quién), cron recuerda 1 vez.';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-de4-transferencias OK (rollback, nada quedó guardado)');
