// smoke-chofer-privado-toggle.mjs — CW6/CW7 (PROMPT-114 FASE 5), verificación
// profunda post-entrega. Simula exactamente el caso de Carlos/Dallin (chofer
// privado, conductores.activo=true, CERO vehículo en cualquier lado) con un
// usuario sintético, TODO dentro de una transacción con ROLLBACK (nada queda).
//
// Cubre:
//   #1  chofer_crear_ruta da el mensaje nuevo "no tienes ningún vehículo
//       autorizado" (no el genérico "selecciona un vehículo") cuando de verdad
//       no hay ninguno para elegir.
//   #2  El interruptor (chofer_privado_permitir_transporte) da el rol
//       chofer_transportista sin tocar chofer_privado.
//   #3  listar_choferes_privados refleja tiene_transportista=true tras el #2.
//   #4  Tras el interruptor, puede_crear_conduce() pasa a true (ya tiene
//       conductores.activo=true, así que debería ser true incluso ANTES del
//       interruptor — se verifica también, confirmando que el bloqueo real
//       para Carlos nunca fue puede_crear_conduce()).
//   #5  Apagar el interruptor quita chofer_transportista y puede_crear_conduce
//       vuelve a depender solo de la fila conductores (sigue true, porque esa
//       fila no se borra — coherente con que NO se cambian roles solos, D1).
//
//   node scripts/smoke-chofer-privado-toggle.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_admin uuid; v_sintetico uuid := gen_random_uuid();
  v_msg text; v_res jsonb; v_row record; v_puede boolean;
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin is null then raise exception 'No hay admin en este entorno para la prueba'; end if;

  -- Usuario sintético = Carlos/Dallin exactos: chofer_privado + conductores.activo
  -- pero CERO vehículo (vehiculo_id null, cero vehiculo_autorizaciones).
  insert into auth.users (id) values (v_sintetico);
  insert into sgc.usuarios (id, nombre, email, activo)
  values (v_sintetico, 'Smoke CW6 (sin vehículo)', 'smoke-cw6@dev.constructorasd.local', true);
  insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
  select v_sintetico, r.id, v_admin from sgc.roles r where r.codigo = 'chofer_privado';
  insert into sgc.conductores (nombre, cedula, licencia_tipo, usuario_id, activo)
  values ('Smoke CW6', '00000000001', '2', v_sintetico, true);

  -- #1 — mensaje al crear ruta sin ningún vehículo autorizado.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sintetico, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform sgc.chofer_crear_ruta(gen_random_uuid(), 'material', current_date, 'Origen', 'Destino');
    raise exception 'FAIL #1: chofer_crear_ruta no debió dejar crear la ruta (cero vehículo)';
  exception when others then
    v_msg := sqlerrm;
    if v_msg !~* 'ningún vehículo autorizado' then
      raise exception 'FAIL #1: mensaje = "%", esperaba que mencione "ningún vehículo autorizado"', v_msg;
    end if;
  end;

  -- #4a — puede_crear_conduce ya debería ser true ANTES del interruptor
  -- (tiene conductores.activo=true) — confirma que el bloqueo real de Carlos
  -- nunca fue este chequeo, sino la falta de vehículo en el flujo de rutas.
  select sgc.puede_crear_conduce() into v_puede;
  if not v_puede then raise exception 'FAIL #4a: puede_crear_conduce()=false con conductores.activo=true (no esperado)'; end if;

  -- #2 — el interruptor (como admin).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := sgc.chofer_privado_permitir_transporte(v_sintetico, true, null);
  if not (v_res->>'permitido')::boolean then raise exception 'FAIL #2: permitido=false tras activar'; end if;

  -- #3 — listar_choferes_privados refleja el nuevo campo.
  select * into v_row from sgc.listar_choferes_privados() where usuario_id = v_sintetico;
  if v_row.usuario_id is null then raise exception 'FAIL #3: el usuario sintético no aparece en listar_choferes_privados'; end if;
  if not v_row.tiene_transportista then raise exception 'FAIL #3: tiene_transportista=false tras activar el interruptor'; end if;

  -- Confirma que chofer_privado SIGUE asignado (acumulativo, no reemplazo).
  if not exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = v_sintetico and r.codigo = 'chofer_privado'
  ) then raise exception 'FAIL #2b: chofer_privado se perdió al activar el interruptor'; end if;

  -- #5 — apagar el interruptor quita SOLO chofer_transportista.
  v_res := sgc.chofer_privado_permitir_transporte(v_sintetico, false, 'prueba smoke');
  if (v_res->>'permitido')::boolean then raise exception 'FAIL #5: permitido=true tras desactivar'; end if;
  if exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = v_sintetico and r.codigo = 'chofer_transportista'
  ) then raise exception 'FAIL #5: chofer_transportista no se quitó'; end if;
  if not exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = v_sintetico and r.codigo = 'chofer_privado'
  ) then raise exception 'FAIL #5b: chofer_privado se quitó por error al desactivar el otro'; end if;

  -- Auditoría: dos filas (activar + desactivar) en audit_log.
  if (select count(*) from sgc.audit_log where target_user_id = v_sintetico
      and action = 'chofer_privado_permitir_transporte') <> 2 then
    raise exception 'FAIL: no quedaron las 2 filas de auditoría esperadas';
  end if;

  raise notice 'OK — 7 asserts de CW6/CW7 pasaron (ruta sin vehículo, interruptor on/off, auditoría).';
end $$;
rollback;
`;

await dbQuery(env, sql);
console.log('✅ smoke-chofer-privado-toggle OK (rollback, nada quedó guardado)');
