// scripts/smoke-de-ronda.mjs — Ronda DE (PROMPT-128/129). SOLO dev.
// Resumen consolidado (patrón smoke-db-ronda.mjs, raise-rollback): sugerencias
// con puntaje, placa oculta, reverso emparejado, badge de inventario acotado,
// oferta a chofer sin usuario rechazada, cancelar transferencia. El detalle
// exhaustivo de cada fase vive en sus propios scripts:
//   smoke-de1-sugerencias.mjs (F1, 8 checks) · smoke-de2-reverso.mjs (F3, 3 checks)
//   smoke-de3-badges.mjs (F4, 4 checks) · smoke-de4-transferencias.mjs (F5, 9 checks)
//
//   node scripts/smoke-de-ronda.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 smoke-de-ronda: SOLO dev.'); process.exit(1); }

const ADMIN = '04a1547b-8e10-447d-89be-6248019c254b'; // QA admin (dev)
const SALIDA_DEMO = '426fa75d-a9e1-4937-867a-e92805ffea09'; // fase 'emitido', es_prueba (CK5)

let pasa = 0, falla = 0;
async function check(nombre, sqlBody) {
  const sql = `do $$
declare _ok boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
${sqlBody}
  raise exception 'SMOKE_OK';
end $$;`;
  try {
    await dbQuery(env, sql);
    console.error(`✗ ${nombre}: el DO terminó sin raise (no debería pasar)`);
    falla++;
  } catch (e) {
    const msg = String(e.message ?? e);
    if (msg.includes('SMOKE_OK')) { console.log(`✓ ${nombre}`); pasa++; }
    else { console.error(`✗ ${nombre}: ${msg.slice(0, 500)}`); falla++; }
  }
}

// ── 1) DE-02 — sugerencias: placa a 1 carácter + marca/modelo → "posible" con razones ──
await check('flota_documentos_sugerir: placa a 1 carácter → candidato con razones', `
  declare v_cand jsonb;
  begin
    v_cand := sgc.flota_documentos_sugerir('{"campos":{"placa":"L478816","chasis":null,"marca":"Kia","modelo":"K2700"}}'::jsonb);
    if jsonb_array_length(v_cand) = 0 then raise exception 'FALLO: sin candidatos'; end if;
    if v_cand->0->>'placa' <> 'L478815' then raise exception 'FALLO: top candidato no es L478815 — %', v_cand; end if;
    if jsonb_array_length(v_cand->0->'razones') = 0 then raise exception 'FALLO: sin razones'; end if;
  end;`);

// ── 2) DE-04 — placa tapada: nunca se compara, empareja por VIN ───────────────
await check('flota_documentos_emparejar: placa tapada (XXXXXXXX) empareja por VIN, no por placa', `
  declare v_r jsonb;
  begin
    v_r := sgc.flota_documentos_emparejar('[{"pagina":1,"tipo":"seguro","campos":{"placa":"XXXXXXXX","chasis":"FE85CGA65815"}}]'::jsonb);
    if v_r->0->>'match' <> 'vin' then raise exception 'FALLO: no emparejó por VIN — %', v_r; end if;
    if (v_r->0->>'placa_oculta')::boolean is not true then raise exception 'FALLO: placa_oculta no quedó true'; end if;
  end;`);

// ── 3) DE-05 — reverso: flota_documentos_aplicar guarda 2do documento, sin tocar campos ──
await check('flota_documentos_aplicar: reverso huérfano guarda SOLO imagen (sin tocar el vehículo)', `
  declare v_res jsonb; v_antes date;
  begin
    select vencimiento_seguro into v_antes from sgc.vehiculos where placa = 'A631739';
    v_res := sgc.flota_documentos_aplicar(jsonb_build_array(jsonb_build_object(
      'vehiculo_id', (select id from sgc.vehiculos where placa='A631739'),
      'tipo', 'reverso', 'pagina', 1, 'campos', '{}'::jsonb, 'imagen_path', 'smoke/de-ronda-reverso.png')));
    if not (v_res->0->>'ok')::boolean then raise exception 'FALLO: no aplicó — %', v_res->0->>'error'; end if;
    if (select vencimiento_seguro from sgc.vehiculos where placa='A631739') is distinct from v_antes then
      raise exception 'FALLO: el reverso huérfano tocó un campo del vehículo';
    end if;
  end;`);

// ── 4) DE-08 — badge de Inventario: total = por_recibir + por_despachar (nunca
//      el conteo plano de "todo despachado", la causa real de DE3) ──────────
await check('badges_modulos_app: inventario (si aparece) trae total = por_recibir + por_despachar', `
  declare v_inv record;
  begin
    select * into v_inv from sgc.badges_modulos_app() where modulo = 'inventario';
    if v_inv.modulo is not null then
      if v_inv.detalle->>'por_recibir' is null or v_inv.detalle->>'por_despachar' is null then
        raise exception 'FALLO: falta por_recibir/por_despachar en detalle — %', v_inv.detalle;
      end if;
      if v_inv.total <> (v_inv.detalle->>'por_recibir')::int + (v_inv.detalle->>'por_despachar')::int then
        raise exception 'FALLO: total no cuadra con el detalle — %', v_inv;
      end if;
    end if;
  end;`);

// ── 5) DE-11 — ofrecer_transferencia_conduce rechaza destino sin usuario ──────
await check('ofrecer_transferencia_conduce: rechaza chofer sin usuario (DR423), sin dejar oferta fantasma', `
  declare v_sin_usuario uuid; v_ok boolean := true; v_cnt int;
  begin
    insert into sgc.conductores (nombre, cedula, licencia_tipo, activo)
    values ('Smoke DE-ronda sin usuario', '00000009999', '2', true) returning id into v_sin_usuario;
    begin
      perform sgc.ofrecer_transferencia_conduce('${SALIDA_DEMO}', v_sin_usuario, null);
      v_ok := false;
    exception when others then null;
    end;
    if not v_ok then raise exception 'FALLO: no rechazó el destino sin usuario'; end if;
    select count(*) into v_cnt from sgc.conduce_transferencias where a_conductor_id = v_sin_usuario;
    if v_cnt <> 0 then raise exception 'FALLO: quedó oferta fantasma (% filas)', v_cnt; end if;
  end;`);

// ── 6) DE-12 — cancelar_transferencia_conduce: solo quien ofreció/Flota/admin, solo "ofrecida" ──
await check('cancelar_transferencia_conduce: cancela una "ofrecida" y queda en estado "cancelada"', `
  declare v_con_usuario uuid; v_usuario_b uuid; v_id uuid;
  begin
    -- setup con el rol base (sin grants directos a authenticated sobre estas
    -- tablas a propósito, regla 10); las RPC de abajo son SECURITY DEFINER y
    -- no dependen del rol de Postgres, solo de auth.uid() (request.jwt.claims).
    reset role;
    insert into auth.users (id) values (gen_random_uuid()) returning id into v_usuario_b;
    insert into sgc.usuarios (id, nombre, email, activo)
    values (v_usuario_b, 'Smoke DE-ronda receptor', 'smoke-de-ronda@dev.constructorasd.local', true);
    insert into sgc.conductores (nombre, cedula, licencia_tipo, usuario_id, activo)
    values ('Smoke DE-ronda con usuario', '00000009998', '2', v_usuario_b, true) returning id into v_con_usuario;
    v_id := sgc.ofrecer_transferencia_conduce('${SALIDA_DEMO}', v_con_usuario, 'smoke de-ronda');
    perform sgc.cancelar_transferencia_conduce(v_id);
    if (select estado from sgc.conduce_transferencias where id = v_id) <> 'cancelada' then
      raise exception 'FALLO: no quedó cancelada';
    end if;
  end;`);

console.log(`\n${pasa} ok, ${falla} fallo(s).`);
process.exit(falla ? 1 : 0);
