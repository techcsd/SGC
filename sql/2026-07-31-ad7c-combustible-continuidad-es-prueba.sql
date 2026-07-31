-- ============================================================================
-- AD7c — Ronda 31/07/2026 — Fix continuidad de combustible en vehículos de prueba
-- ----------------------------------------------------------------------------
-- Bug: al registrar una echada en un vehículo de PRUEBA (es_prueba=true), el
-- sistema decía "primera echada" y no recordaba el km anterior. Causa: el
-- trigger `trg_heredar_es_prueba` marca la echada como es_prueba=true (heredado
-- del vehículo), pero la búsqueda del km anterior (y del baseline/flota) filtraba
-- `es_prueba = false`, excluyendo TODAS las echadas previas del propio vehículo.
--
-- Fix: la continuidad y las estadísticas se calculan DENTRO del mismo contexto
-- es_prueba (comparar prueba-con-prueba, real-con-real). Así:
--   - Un vehículo de prueba recuerda sus propias echadas de prueba.
--   - Un vehículo real sigue ignorando las echadas de prueba (datos aislados).
--
-- Incluye backfill de km_anterior/km_recorridos/rendimiento/costo del histórico
-- (las echadas que quedaron con km_anterior nulo por este bug) vía LAG particionado
-- por (vehiculo, es_prueba).
-- ============================================================================

-- 1) registrar_combustible_app: km_anterior + baseline + flota por contexto es_prueba.
create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric,
  p_estacion text default null, p_foto_recibo_path text default null,
  p_foto_tablero_path text default null, p_notas text default null,
  p_foto_bomba_path text default null, p_producto text default null,
  p_tarjeta text default null, p_titular text default null,
  p_titular_es_persona boolean default false, p_subtipo text default null,
  p_origen text default 'estacion', p_proyecto_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_odometro     int;
  v_km_anterior  int;
  v_km_recorridos int;
  v_precio       numeric;
  v_rendimiento  numeric;
  v_costo_km     numeric;
  v_prom         numeric;
  v_n_prev       int;
  v_esperado     numeric;
  v_prom_flota   numeric;
  v_ref_valor    numeric;
  v_ref_tipo     text;
  v_alerta       boolean := false;
  v_motivo       text;
  v_estado       text;
  v_baseline     numeric;
  v_dist_min     numeric;
  v_piso_c       numeric;
  v_techo_c      numeric;
  v_min_reg      int;
  v_placa        text;
  v_es_prueba    boolean := false;
  v_medida       text := 'km';
  v_uni          text := 'km';
  v_ren          text := 'km/gal';
  v_origen       text := lower(coalesce(nullif(p_origen,''),'estacion'));
  v_deposito     boolean;
  v_persona      boolean := coalesce(p_titular_es_persona, false) or p_vehiculo_id is null;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  if v_origen not in ('estacion','deposito_obra') then v_origen := 'estacion'; end if;
  v_deposito := (v_origen = 'deposito_obra');
  if v_deposito then v_persona := false; end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if not v_deposito and coalesce(p_monto, 0) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;
    select coalesce(es_prueba, false), coalesce(kilometraje, 0), coalesce(medida_uso, 'km')
      into v_es_prueba, v_odometro, v_medida
      from sgc.vehiculos where id = p_vehiculo_id;
    v_uni := case when v_medida = 'horas' then 'h' else 'km' end;
    v_ren := case when v_medida = 'horas' then 'h/gal' else 'km/gal' end;

    if coalesce(p_kilometraje, 0) <= 0 then
      raise exception 'La lectura (%) debe ser mayor que 0', v_uni;
    end if;
    if p_kilometraje < v_odometro then
      raise exception 'La lectura (% %) no puede ser menor a la lectura actual del vehículo (% %).',
        p_kilometraje, v_uni, v_odometro, v_uni using errcode = '23514';
    end if;

    -- La echada anterior se busca en el MISMO contexto es_prueba del vehículo.
    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba;

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;
    end if;

    if v_medida = 'horas' then
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_horas'), 3);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_min_horas_gal'), 0.05);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_max_horas_gal'), 1.0);
    else
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_km'), 50);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
    end if;
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

    -- Baseline propio: echadas plausibles del mismo vehículo Y mismo contexto es_prueba.
    select count(*), avg(rendimiento_km_gal) into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    -- Promedio de flota en el mismo contexto (prueba vs real, aislados).
    select avg(rendimiento_km_gal) into v_prom_flota
      from sgc.registros_combustible
     where rendimiento_km_gal is not null and coalesce(es_prueba, false) = v_es_prueba
       and km_recorridos >= v_dist_min;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n_prev >= v_min_reg then v_prom else null end;
    v_ref_tipo := case when v_esperado is not null and v_esperado > 0 then 'esperado'
                       when v_n_prev >= v_min_reg then 'propio' else null end;
    v_ref_valor := v_baseline;

    select estado, motivo into v_estado, v_motivo
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true);
    v_alerta := (v_estado = 'anormal');
  end if;

  v_precio := case when coalesce(p_galones,0) > 0 and coalesce(p_monto,0) > 0
                   then round(p_monto / p_galones, 2) else null end;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, foto_bomba_path,
    alerta_consumo, motivo_alerta, estado, client_uuid,
    producto, subtipo, tarjeta, titular, titular_es_persona,
    origen, proyecto_id
  ) values (
    v_id,
    case when v_persona then null else p_vehiculo_id end,
    p_conductor_id, coalesce(p_fecha, current_date),
    case when v_persona then null else p_kilometraje end,
    p_galones, nullif(p_monto, 0), v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    case when v_deposito then null else nullif(p_estacion,'') end,
    nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, v_estado, p_client_uuid,
    nullif(p_producto,''), nullif(p_subtipo,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false),
    v_origen, p_proyecto_id
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    if v_alerta and not v_es_prueba then
      select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
      insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
      values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
        format('Consumo anormal en %s: %s Posible fuga, problema mecánico o combustible desviado.',
          coalesce(v_placa,'vehículo'), v_motivo),
        'alta');
      perform sgc.notificar_modulo('flota', 'warning',
        'Consumo anormal de combustible',
        format('%s: %s', coalesce(v_placa,'Un vehículo'), v_motivo),
        '/flota/combustible');
    end if;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'estado', v_estado,
    'motivo_alerta', v_motivo,
    'promedio_rendimiento', case when v_n_prev >= v_min_reg then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona,
    'origen', v_origen
  );
end;
$function$;

-- 2) recalcular_estados_combustible: baseline en el mismo contexto es_prueba.
create or replace function sgc.recalcular_estados_combustible()
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_count int := 0; r record;
  v_medida text; v_esperado numeric; v_baseline numeric; v_n int; v_prom numeric;
  v_dist_min numeric; v_piso_c numeric; v_techo_c numeric; v_min_reg int;
  v_estado text; v_motivo text; v_ep boolean;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede recalcular el histórico'; end if;
  for r in
    select id, vehiculo_id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) as ep
      from sgc.registros_combustible
     where vehiculo_id is not null
     order by vehiculo_id, coalesce(es_prueba,false), kilometraje
  loop
    v_ep := r.ep;
    select coalesce(medida_uso,'km'), rendimiento_esperado_km_gal into v_medida, v_esperado
      from sgc.vehiculos where id = r.vehiculo_id;
    if v_medida = 'horas' then
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_horas'), 3);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_min_horas_gal'), 0.05);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_max_horas_gal'), 1.0);
    else
      v_dist_min := coalesce((select valor from sgc.flota_config where clave='dist_min_km'), 50);
      v_piso_c   := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
      v_techo_c  := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
    end if;
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select count(*), avg(rendimiento_km_gal) into v_n, v_prom
      from sgc.registros_combustible
     where vehiculo_id = r.vehiculo_id and id <> r.id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_ep
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;

    select estado, motivo into v_estado, v_motivo
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true);

    update sgc.registros_combustible
       set estado = v_estado, motivo_alerta = v_motivo, alerta_consumo = (v_estado = 'anormal')
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 3) Backfill del histórico: recomputa km_anterior/km_recorridos/rendimiento/costo
--    con LAG particionado por (vehiculo, es_prueba). Corrige las echadas que
--    quedaron con km_anterior nulo por el bug (p. ej. el vehículo de prueba).
with ordered as (
  select id, vehiculo_id, kilometraje, galones, monto, coalesce(es_prueba,false) as ep,
         lag(kilometraje) over (
           partition by vehiculo_id, coalesce(es_prueba,false)
           order by kilometraje, created_at
         ) as prev_km
  from sgc.registros_combustible
  where vehiculo_id is not null and kilometraje is not null
)
update sgc.registros_combustible r set
  km_anterior = o.prev_km,
  km_recorridos = case when o.prev_km is not null then r.kilometraje - o.prev_km else null end,
  rendimiento_km_gal = case
    when o.prev_km is not null and (r.kilometraje - o.prev_km) > 0 and r.galones > 0
    then round((r.kilometraje - o.prev_km)::numeric / r.galones, 2) else null end,
  costo_por_km = case
    when o.prev_km is not null and (r.kilometraje - o.prev_km) > 0 and coalesce(r.monto,0) > 0
    then round(r.monto / (r.kilometraje - o.prev_km), 2) else null end
from ordered o
where o.id = r.id
  and (r.km_anterior is distinct from o.prev_km);
