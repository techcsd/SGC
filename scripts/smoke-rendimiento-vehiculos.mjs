// smoke-rendimiento-vehiculos.mjs — CW4 (PROMPT-114 FASE 3).
//
// Prueba sgc.reporte_rendimiento_vehiculos con datos sintéticos, TODO dentro de
// una transacción con ROLLBACK (nada se guarda). Cubre el método D4:
//   #1  excluye la primera echada del período del cálculo (Σkm/Σgal)
//   #2  excluye echadas duplicadas (mismo vehículo+galones+monto en <5min)
//   #3  confianza "alta" con suficientes echadas y distancia
//   #4  vehículo por horas usa unidad "gal/hora"
//
//   node scripts/smoke-rendimiento-vehiculos.mjs --env dev
import './lib/load-env.mjs';
import { resolverEnv, dbQuery } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));

const sql = `
begin;
do $$
declare
  v_admin uuid; v_veh_km uuid; v_veh_horas uuid; v_res record; v_n int;
begin
  select ur.usuario_id into v_admin from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id where r.codigo = 'admin' limit 1;
  if v_admin is null then raise exception 'No hay admin en este entorno para la prueba'; end if;

  insert into sgc.vehiculos (id, placa, marca, modelo, anio, medida_uso, activo, es_prueba, tipo)
  values (gen_random_uuid(), 'SMOKE-CW4-KM', 'Smoke', 'CW4', 2020, 'km', true, true, 'otro')
  returning id into v_veh_km;
  insert into sgc.vehiculos (id, placa, marca, modelo, anio, medida_uso, activo, es_prueba, tipo)
  values (gen_random_uuid(), 'SMOKE-CW4-HORAS', 'Smoke', 'CW4', 2020, 'horas', true, true, 'otro')
  returning id into v_veh_horas;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- #1/#3 — 4 echadas: la primera (km_recorridos null, primer tanque) debe EXCLUIRSE.
  insert into sgc.registros_combustible (id, vehiculo_id, fecha, galones, km_recorridos, monto, es_prueba, registrado_por, foto_tablero_path)
  values
    (gen_random_uuid(), v_veh_km, current_date - 20, 10, null, 1000, true, v_admin, 'smoke/tab.jpg'),
    (gen_random_uuid(), v_veh_km, current_date - 15, 10, 300, 1000, true, v_admin, 'smoke/tab.jpg'),
    (gen_random_uuid(), v_veh_km, current_date - 10, 10, 300, 1000, true, v_admin, 'smoke/tab.jpg'),
    (gen_random_uuid(), v_veh_km, current_date - 5,  10, 300, 1000, true, v_admin, 'smoke/tab.jpg');

  -- #2 — duplicado: mismo galones/monto a 1 minuto de la última echada.
  insert into sgc.registros_combustible (id, vehiculo_id, fecha, galones, km_recorridos, monto, es_prueba, registrado_por, created_at, foto_tablero_path)
  values (gen_random_uuid(), v_veh_km, current_date - 5, 10, 300, 1000, true, v_admin,
          (select created_at + interval '1 minute' from sgc.registros_combustible
            where vehiculo_id = v_veh_km order by created_at desc limit 1),
          'smoke/tab.jpg');

  select * into v_res from sgc.reporte_rendimiento_vehiculos(current_date - 30, current_date, v_veh_km);
  if v_res.echadas_total <> 5 then raise exception 'FAIL #1/#2 echadas_total=% (esperaba 5)', v_res.echadas_total; end if;
  if v_res.echadas_excluidas_dup <> 1 then raise exception 'FAIL #2 echadas_excluidas_dup=% (esperaba 1)', v_res.echadas_excluidas_dup; end if;
  if v_res.echadas_usadas <> 2 then raise exception 'FAIL #1 echadas_usadas=% (esperaba 2: se descarta la primera Y el duplicado)', v_res.echadas_usadas; end if;
  if v_res.total_km <> 600 then raise exception 'FAIL #1 total_km=% (esperaba 600 = 300+300, sin la primera)', v_res.total_km; end if;
  if v_res.rendimiento <> 30 then raise exception 'FAIL #1 rendimiento=% (esperaba 600/20=30)', v_res.rendimiento; end if;
  if v_res.unidad <> 'km/gal' then raise exception 'FAIL unidad=%', v_res.unidad; end if;
  if v_res.confianza <> 'media' then raise exception 'FAIL #3 confianza=% (esperaba media: 2 echadas, 600km)', v_res.confianza; end if;

  -- #4 — vehículo por horas: unidad correcta, sin datos (solo 1 echada = la primera, se excluye).
  insert into sgc.registros_combustible (id, vehiculo_id, fecha, galones, km_recorridos, monto, es_prueba, registrado_por, foto_tablero_path)
  values (gen_random_uuid(), v_veh_horas, current_date - 1, 5, null, 500, true, v_admin, 'smoke/tab.jpg');
  select * into v_res from sgc.reporte_rendimiento_vehiculos(current_date - 30, current_date, v_veh_horas);
  if v_res.unidad <> 'gal/hora' then raise exception 'FAIL #4 unidad=% (esperaba gal/hora)', v_res.unidad; end if;
  if v_res.confianza <> 'sin_datos' then raise exception 'FAIL #4 confianza=% (esperaba sin_datos: solo la primera echada)', v_res.confianza; end if;

  raise notice 'OK — 5 asserts del método D4 pasaron.';
end $$;
rollback;
`;

const out = await dbQuery(env, sql);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
console.log('✅ smoke-rendimiento-vehiculos OK (rollback, nada quedó guardado)');
