// scripts/smoke-db-ronda.mjs — Ronda DB (PROMPT-124 F9, DB-18). SOLO dev.
// Cada check corre dentro de un DO $$ que termina en `raise exception 'SMOKE_OK…'`
// → TODO se revierte (patrón raise-rollback de BV/BR); el script valida que el
// error contenga SMOKE_OK. Nada queda escrito en dev.
//
//   node scripts/smoke-db-ronda.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';
import { readFileSync } from 'node:fs';

const env = await resolverEnv(process.argv.slice(2));
if (env.entorno !== 'dev') { console.error('🔴 smoke-db-ronda: SOLO dev.'); process.exit(1); }

const ADMIN = '04a1547b-8e10-447d-89be-6248019c254b'; // QA admin (dev)
const JOAN = '48b2fa80-cb42-48f3-9c03-2ad68ec1356b'; // chofer con asignación activa (L542136)
const LOGISTICA = 'e98aa1e3-03e5-4e9e-8282-fadffd370957'; // QA logistica (sin pagos)
const SOCRATES = '00386592-6217-4104-b8f9-84b51463338b'; // ingeniero (opera pagos de SUS obras)
const OBRA = '9ef32aaa-649b-4e68-870c-6c82d24c748a'; // Torre Alpha (real, dev)
const BODEGA = 'cb33cd2a-ca75-45ab-b96f-8767dbc9390e';
const VEH_JOAN = '16aea7c8-9b27-4358-8f82-e6fffe6c2c97'; // L542136

let pasa = 0, falla = 0;
async function check(nombre, sqlBody) {
  const sql = `do $$
declare _ok boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true);
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
    else { console.error(`✗ ${nombre}: ${msg.slice(0, 400)}`); falla++; }
  }
}

// ── 1) DB12 — el cron NO cierra un uso (>24 h) con asignación activa… ─────────
await check('cron respeta la asignación activa (uso de 2 días sigue abierto)', `
  insert into sgc.vehiculo_usos (vehiculo_id, usuario_id, inicio_at, es_prueba)
  values ('${VEH_JOAN}', '${JOAN}', now() - interval '2 days', false);
  perform sgc.cerrar_usos_huerfanos(24);
  if not exists (select 1 from sgc.vehiculo_usos
                 where usuario_id = '${JOAN}' and vehiculo_id = '${VEH_JOAN}'
                   and fin_at is null and inicio_at < now() - interval '1 day') then
    raise exception 'FALLO: el cron cerró el uso aunque Joan tiene asignación activa';
  end if;`);

// ── 2) …pero SÍ lo cierra pasado el tope de 7 días ────────────────────────────
await check('cron cierra igual a los 7 días (tope uso_vehiculo_max_dias_asignado)', `
  insert into sgc.vehiculo_usos (vehiculo_id, usuario_id, inicio_at, es_prueba)
  values ('${VEH_JOAN}', '${JOAN}', now() - interval '8 days', false);
  perform sgc.cerrar_usos_huerfanos(24);
  if exists (select 1 from sgc.vehiculo_usos
             where usuario_id = '${JOAN}' and vehiculo_id = '${VEH_JOAN}'
               and fin_at is null and inicio_at < now() - interval '7 days') then
    raise exception 'FALLO: el uso de 8 días con asignación sigue abierto';
  end if;`);

// ── 3) DB12 — mi_unidad() de Joan devuelve su asignación ──────────────────────
await check('mi_unidad() devuelve L542136 para Joan (con bandera visible honesta)', `
  perform set_config('request.jwt.claims', '{"sub":"${JOAN}","role":"authenticated"}', true);
  if not exists (select 1 from sgc.mi_unidad() u where u.placa = 'L542136') then
    raise exception 'FALLO: mi_unidad no devolvió la unidad asignada de Joan';
  end if;`);

// ── 4) DB9 — aprobar_requisicion capa la cantidad al pendiente ────────────────
await check('aprobar_requisicion recorta 250 → 200 (pendiente del renglón)', `
  declare
    v_sol uuid; v_item uuid; v_res jsonb; v_total numeric;
  begin
    insert into sgc.solicitudes_material (proyecto_id, solicitante_id, estado)
    values ('${OBRA}', '${SOCRATES}', 'pendiente') returning id into v_sol;
    insert into sgc.solicitud_material_items (solicitud_id, descripcion, cantidad, unidad)
    values (v_sol, 'BASE 100X100CM CSD (smoke)', 200, 'unidad') returning id into v_item;
    v_res := sgc.aprobar_requisicion(v_sol, '${BODEGA}'::uuid, current_date, null, 'smoke db-ronda',
      jsonb_build_array(jsonb_build_object('descripcion','BASE 100X100CM CSD (smoke)','cantidad',250,'item_id',v_item)));
    v_total := coalesce((v_res->>'despachado_total')::numeric,0) + coalesce((v_res->>'faltante_total')::numeric,0);
    if v_total <> 200 then
      raise exception 'FALLO: aprobó % en vez de 200 (cap al pendiente)', v_total;
    end if;
  end;`);

// ── 5) DB3 — emparejar: exacta / distancia 1 (Revisar) / sin vehículo ─────────
await check('flota_documentos_emparejar: exacta, 1-carácter=revisar, desconocida=sin_vehiculo', `
  declare v jsonb;
  begin
    v := sgc.flota_documentos_emparejar(jsonb_build_array(
      jsonb_build_object('pagina',1,'tipo','seguro','campos',jsonb_build_object('placa','K2347567')),
      jsonb_build_object('pagina',2,'tipo','seguro','campos',jsonb_build_object('placa','L441680')),
      jsonb_build_object('pagina',3,'tipo','seguro','campos',jsonb_build_object('placa','ZZ999999'))));
    if v->0->>'match' <> 'exacta' or v->1->>'match' <> 'revisar' or v->2->>'match' <> 'sin_vehiculo' then
      raise exception 'FALLO: % / % / %', v->0->>'match', v->1->>'match', v->2->>'match';
    end if;
  end;`);

// ── 6) DB5 — levantamiento: registrar = presente hoy + nuevos/cerrar ──────────
await check('levantamiento: alta de personal lo marca presente hoy y el día se cierra', `
  declare v_p uuid; v_lev jsonb; v_linea jsonb;
  begin
    insert into sgc.personal_obra (proyecto_id, nombre, apellido, nacionalidad, tipo_documento, documento_numero, registrado_por)
    values ('${OBRA}', 'SMOKE', 'DB RONDA', 'dominicano', 'cedula', '000-0000000-0', '${ADMIN}') returning id into v_p;
    v_lev := sgc.levantamiento_de_hoy('${OBRA}'::uuid);
    select l into v_linea from jsonb_array_elements(v_lev->'personal') l
      where l->>'personal_id' = v_p::text;
    if v_linea is null or (v_linea->>'presente')::boolean is not true or (v_linea->>'nuevo_hoy')::boolean is not true then
      raise exception 'FALLO: el alta no quedó presente/nuevo hoy: %', v_linea;
    end if;
    perform sgc.levantamiento_cerrar((v_lev->>'id')::uuid);
    if (select cerrado_at from sgc.personal_obra_levantamientos where id = (v_lev->>'id')::uuid) is null then
      raise exception 'FALLO: el día no se cerró';
    end if;
  end;`);

// ── 7) DB4 — pagos: enviar sin firmas se rechaza ──────────────────────────────
await check('pagos_obra_enviar rechaza una semana sin ningún descargo firmado', `
  declare v_pago uuid; v_err boolean := false;
  begin
    v_pago := sgc.pagos_obra_crear('${OBRA}'::uuid, current_date, current_date + 6);
    begin
      perform sgc.pagos_obra_enviar(v_pago);
    exception when others then
      v_err := sqlerrm like '%firma%' or sqlerrm like '%firmado%';
    end;
    if not v_err then raise exception 'FALLO: envió la semana sin firmas'; end if;
  end;`);

// ── 8) DB4 — gates negativos: logística NI crea NI ve pagos ───────────────────
await check('logística no puede crear pagos (42501) ni ver filas por RLS', `
  declare v_err boolean := false; v_filas int;
  begin
    perform set_config('request.jwt.claims', '{"sub":"${LOGISTICA}","role":"authenticated"}', true);
    begin
      perform sgc.pagos_obra_crear('${OBRA}'::uuid, current_date, current_date + 6);
    exception when others then v_err := (sqlstate = '42501');
    end;
    if not v_err then raise exception 'FALLO: logística pudo crear la semana de pagos'; end if;
    perform set_config('role', 'authenticated', true);
    select count(*) into v_filas from sgc.pagos_obra;
    if v_filas <> 0 then raise exception 'FALLO: logística ve % fila(s) de pagos', v_filas; end if;
  end;`);

// ── 9) DB6 — reporte_ia_resumen: gate admin/tecnología ────────────────────────
await check('reporte_ia_resumen rechaza a un usuario sin admin/tecnología (42501)', `
  declare v_err boolean := false;
  begin
    perform set_config('request.jwt.claims', '{"sub":"${JOAN}","role":"authenticated"}', true);
    begin
      perform sgc.reporte_ia_resumen(gen_random_uuid());
    exception when others then v_err := (sqlstate = '42501');
    end;
    if not v_err then raise exception 'FALLO: el gate de resúmenes no rechazó a un chofer'; end if;
  end;`);

// ── 10) DB1 — tablero: gate por módulos ───────────────────────────────────────
// (el chofer SÍ pasa el gate — su rol tiene el módulo flota — pero su dashboard
// ni pinta el tablero; el rechazo se prueba con un usuario SIN módulos.)
await check('tablero_vivo_resumen rechaza a un usuario sin módulos de gestión (42501)', `
  declare v_err boolean := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    begin
      perform sgc.tablero_vivo_resumen();
    exception when others then v_err := (sqlstate = '42501');
    end;
    if not v_err then raise exception 'FALLO: el tablero no rechazó a un usuario sin módulos'; end if;
  end;`);

// ── 11) estático — el conector NO expone pagos (además del guard de build) ────
{
  const herramientas = readFileSync('supabase/functions/_shared/herramientas.ts', 'utf8');
  if (/pagos_obra/i.test(herramientas)) {
    console.error('✗ conector sin pagos: herramientas.ts menciona pagos_obra');
    falla++;
  } else {
    console.log('✓ conector sin pagos (herramientas.ts no menciona pagos_obra)');
    pasa++;
  }
}

console.log(`\n${pasa} ✓ · ${falla} ✗`);
process.exit(falla ? 1 : 0);
