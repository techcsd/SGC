-- ════════════════════════════════════════════════════════════════════════════
-- CH1 — Validación de kilometraje del mantenimiento contra las lecturas del
--        vehículo (una sola regla, web = app). Corrige el FALSO POSITIVO: hoy la
--        web avisa (rojo) con cualquier km mayor al odómetro actual, que es lo
--        NORMAL (llegar al taller con más km del que había). Nota #138.
--
-- Regla correcta (Xaviel tiene razón):
--   • Subir respecto al odómetro ACTUAL = normal (sin aviso).
--   • BLOQUEA solo:
--       – retroceso: km < la última lectura ANTERIOR a la fecha, o
--       – imposible retroactivo: km > la primera lectura POSTERIOR a la fecha.
--   • AVISO ámbar (no bloquea, pide confirmar): salto inverosímil
--       (km − km_antes)/días > km_dia_max (800) · horas_dia_max (24) para equipos
--       por horas. Editable en Umbrales de flota (CE13 → flota_config).
--
-- Fuentes de lecturas con fecha que inventariamos (todas las vías que escriben
-- un odómetro/horómetro con fecha):
--   1. echadas de combustible   sgc.registros_combustible (fecha, kilometraje)
--   2. inspecciones / pre-uso   sgc.checklists_vehiculo   (fecha, kilometraje)
--   3. recepción / devolución   sgc.vehiculo_entregas     (capturado_en, km)
--   4. mantenimientos           sgc.mantenimientos         (fecha, kilometraje_al_mantenimiento)
--   (El odómetro vivo sgc.vehiculos.kilometraje NO tiene fecha → no se usa como
--    cota con fecha; de usarlo bloquearía todo retroactivo, que es justo el bug.)
--
-- SECURITY DEFINER con gate `tiene_modulo('flota') or is_admin()`: es de SOLO
-- LECTURA y cruza 4 tablas con RLS distinta (combustible, checklists, entregas,
-- mantenimientos); un INVOKER haría seq-scan con funciones por fila (misma causa
-- del timeout CD4) y además un plain-flota sin módulo compras no vería echadas.
-- El gate explícito replica el de `listar_mantenimientos` (regla 2/3). ADITIVO.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

-- ── (1) Umbrales de salto inverosímil (editables en Umbrales de flota, CE13) ──
insert into sgc.flota_config (clave, valor) values
  ('km_dia_max', 800),      -- km/día por encima de los cuales se pide confirmar
  ('horas_dia_max', 24)     -- horas/día (equipos por horómetro); 24 = tope físico
on conflict (clave) do nothing;

-- ── (2) validar_km_vehiculo ───────────────────────────────────────────────────
create or replace function sgc.validar_km_vehiculo(
  p_vehiculo uuid,
  p_km numeric,
  p_fecha timestamptz,
  p_excluir_mant uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_medida   text;
  v_unidad   text;
  v_fecha    date := coalesce(p_fecha::date, current_date);
  v_km_antes     numeric; v_fecha_antes date; v_fuente_antes text;
  v_km_despues   numeric; v_fecha_despues date; v_fuente_despues text;
  v_dias     numeric;
  v_umbral   numeric;
  v_tasa     numeric;
  v_nivel    text := 'ok';
  v_mensaje  text := null;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'Tu usuario no tiene el módulo Flota' using errcode = '42501';
  end if;
  if p_vehiculo is null or p_km is null then
    return jsonb_build_object('ok', true, 'nivel', 'ok');
  end if;

  select coalesce(medida_uso,'km') into v_medida from sgc.vehiculos where id = p_vehiculo;
  if v_medida is null then
    return jsonb_build_object('ok', true, 'nivel', 'ok'); -- vehículo inexistente: no estorbar
  end if;
  v_unidad := case when v_medida = 'horas' then 'h' else 'km' end;

  -- Todas las lecturas con fecha del vehículo (real, no datos de prueba). El CTE
  -- solo vive en UN statement, así que resolvemos antes/después en una sola query.
  with lecturas as (
    select rc.fecha::date as f, rc.kilometraje::numeric as km, 'echada'::text as fuente
      from sgc.registros_combustible rc
     where rc.vehiculo_id = p_vehiculo and rc.kilometraje is not null
       and not coalesce(rc.invalidada,false) and not coalesce(rc.es_prueba,false)
    union all
    select cv.fecha::date, cv.kilometraje, 'inspección'
      from sgc.checklists_vehiculo cv
     where cv.vehiculo_id = p_vehiculo and cv.kilometraje is not null
    union all
    select coalesce(ve.capturado_en, ve.created_at)::date, ve.km, 'entrega'
      from sgc.vehiculo_entregas ve
     where ve.vehiculo_id = p_vehiculo and ve.km is not null
    union all
    select m.fecha::date, m.kilometraje_al_mantenimiento::numeric, 'mantenimiento'
      from sgc.mantenimientos m
     where m.vehiculo_id = p_vehiculo and m.kilometraje_al_mantenimiento is not null
       and not coalesce(m.es_prueba,false)
       and (p_excluir_mant is null or m.id <> p_excluir_mant)
  ),
  ant as (select km, f, fuente from lecturas where f <= v_fecha order by f desc, km desc limit 1),
  des as (select km, f, fuente from lecturas where f >  v_fecha order by f asc,  km asc  limit 1)
  select ant.km, ant.f, ant.fuente, des.km, des.f, des.fuente
    into v_km_antes, v_fecha_antes, v_fuente_antes, v_km_despues, v_fecha_despues, v_fuente_despues
    from (select 1) x
    left join ant on true
    left join des on true;

  -- BLOQUEA: retroceso contra la lectura anterior a la fecha.
  if v_km_antes is not null and p_km < v_km_antes then
    v_nivel := 'error';
    v_mensaje := format('El %s %s registró %s %s; este registro (%s) no puede tener menos.',
      to_char(v_fecha_antes,'DD/MM/YYYY'), v_fuente_antes,
      trim(to_char(v_km_antes,'FM999G999G990')), v_unidad, to_char(v_fecha,'DD/MM/YYYY'));

  -- BLOQUEA: excede una lectura posterior (imposible en un registro retroactivo).
  elsif v_km_despues is not null and p_km > v_km_despues then
    v_nivel := 'error';
    v_mensaje := format('El %s (%s) la lectura fue %s %s; este registro (%s) es anterior y no puede superarla.',
      to_char(v_fecha_despues,'DD/MM/YYYY'), v_fuente_despues,
      trim(to_char(v_km_despues,'FM999G999G990')), v_unidad, to_char(v_fecha,'DD/MM/YYYY'));

  -- AVISO ámbar: salto inverosímil respecto a la última lectura anterior.
  elsif v_km_antes is not null and p_km > v_km_antes then
    v_dias := greatest(1, (v_fecha - v_fecha_antes));
    v_umbral := coalesce(
      (select valor from sgc.flota_config
        where clave = case when v_medida='horas' then 'horas_dia_max' else 'km_dia_max' end),
      case when v_medida='horas' then 24 else 800 end);
    v_tasa := (p_km - v_km_antes) / v_dias;
    if v_tasa > v_umbral then
      v_nivel := 'aviso';
      v_mensaje := format('Son %s %s más que la última lectura de hace %s día(s). ¿Es correcto?',
        trim(to_char(p_km - v_km_antes,'FM999G999G990')), v_unidad, trim(to_char(v_dias,'FM999G990')));
    end if;
  end if;

  return jsonb_build_object(
    'ok', v_nivel <> 'error',
    'nivel', v_nivel,
    'unidad', v_unidad,
    'medida_uso', v_medida,
    'km_antes', v_km_antes,
    'fecha_antes', v_fecha_antes,
    'fuente_antes', v_fuente_antes,
    'km_despues', v_km_despues,
    'fecha_despues', v_fecha_despues,
    'fuente_despues', v_fuente_despues,
    'mensaje', v_mensaje
  );
end;
$function$;
grant execute on function sgc.validar_km_vehiculo(uuid, numeric, timestamptz, uuid) to authenticated, service_role;

-- ── (3) El mantenimiento creado/editado desde la web avanza el odómetro ───────
-- Hoy la web inserta/actualiza `mantenimientos` directo (sin pasar por
-- `completar_mantenimiento`/`crear_mantenimiento_app`), así que el odómetro real
-- (`vehiculos.kilometraje`) NO se movía al crear/editar desde la web. Centralizamos
-- el avance en un trigger (como `tg_mant_km_ultimo` centraliza km_ultimo): llama a
-- `avanzar_odometro`, que SOLO sube si el km nuevo es mayor → un mantenimiento
-- retroactivo (km menor) no toca el odómetro. Las vías de la app ya llamaban a
-- `avanzar_odometro`; el trigger es idempotente con ellas (no retrocede nunca).
create or replace function sgc.tg_mant_avanzar_odometro() returns trigger
language plpgsql security definer set search_path to 'sgc','pg_temp' as $function$
begin
  if NEW.kilometraje_al_mantenimiento is not null then
    perform sgc.avanzar_odometro(NEW.vehiculo_id, NEW.kilometraje_al_mantenimiento::numeric);
  end if;
  return NEW;
end; $function$;

drop trigger if exists trg_mant_avanzar_odometro on sgc.mantenimientos;
create trigger trg_mant_avanzar_odometro
  after insert or update of kilometraje_al_mantenimiento on sgc.mantenimientos
  for each row execute function sgc.tg_mant_avanzar_odometro();

commit;
