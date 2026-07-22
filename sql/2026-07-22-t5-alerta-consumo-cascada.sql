-- ============================================================================
-- Actualización 4 — T5: alertas de consumo en cascada.
-- ----------------------------------------------------------------------------
-- Antes: la alerta solo comparaba contra el promedio propio con >=3 registros;
-- 8.63 km/gal pasó como "normal" por falta de historial y sin usar el
-- rendimiento_esperado_km_gal (S20). Ahora, evaluación en cascada:
--   (1) si el vehículo tiene rendimiento_esperado_km_gal → alerta si cae X% por
--       debajo (aunque no haya historial);
--   (2) si no, promedio propio (>=3 registros);
--   (3) promedio de flota como referencia informativa (no dispara sola).
-- Umbral configurable (flota_config.umbral_consumo_pct, default 20).
-- Devuelve las tres referencias para el "Análisis automático" del detalle.
-- Misma firma (retrocompatible). Cubre web y app (ambos usan este RPC).
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.registrar_combustible_app(
  p_client_uuid       uuid,
  p_vehiculo_id       uuid,
  p_conductor_id      uuid,
  p_fecha             date,
  p_kilometraje       int,
  p_galones           numeric,
  p_monto             numeric,
  p_estacion          text default null,
  p_foto_recibo_path  text default null,
  p_foto_tablero_path text default null,
  p_notas             text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid          uuid := auth.uid();
  v_id           uuid;
  v_km_anterior  int;
  v_km_recorridos int;
  v_precio       numeric;
  v_rendimiento  numeric;
  v_costo_km     numeric;
  v_prom         numeric;
  v_n_prev       int;
  v_umbral       numeric;
  v_esperado     numeric;
  v_prom_flota   numeric;
  v_ref_valor    numeric;   -- referencia contra la que se disparó
  v_ref_tipo     text;      -- 'esperado' | 'propio' | null
  v_alerta       boolean := false;
  v_placa        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;
  if coalesce(p_kilometraje, 0) <= 0 then raise exception 'El kilometraje debe ser mayor que 0'; end if;
  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  select max(kilometraje) into v_km_anterior
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and kilometraje is not null;

  if v_km_anterior is not null and p_kilometraje <= v_km_anterior then
    raise exception 'El kilometraje (%) debe ser mayor al de la última echada del vehículo (% km).',
      p_kilometraje, v_km_anterior;
  end if;

  v_precio := round(p_monto / p_galones, 2);

  if v_km_anterior is not null then
    v_km_recorridos := p_kilometraje - v_km_anterior;
    if v_km_recorridos > 0 then
      v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
      v_costo_km    := round(p_monto / v_km_recorridos, 2);
    end if;
  end if;

  -- Referencias: esperado del vehículo, promedio propio (>=3), promedio de flota.
  select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

  select count(*), avg(rendimiento_km_gal)
    into v_n_prev, v_prom
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null;

  select avg(rendimiento_km_gal) into v_prom_flota
    from sgc.registros_combustible where rendimiento_km_gal is not null;

  select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
  v_umbral := coalesce(v_umbral, 20);

  -- Cascada de evaluación (solo si hay rendimiento calculable).
  if v_rendimiento is not null then
    if v_esperado is not null and v_esperado > 0 then
      v_ref_tipo := 'esperado'; v_ref_valor := v_esperado;
      if v_rendimiento < (1 - v_umbral / 100.0) * v_esperado then v_alerta := true; end if;
    elsif v_n_prev >= 3 and v_prom is not null then
      v_ref_tipo := 'propio'; v_ref_valor := v_prom;
      if v_rendimiento < (1 - v_umbral / 100.0) * v_prom then v_alerta := true; end if;
    end if;
  end if;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, alerta_consumo, client_uuid
  ) values (
    v_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), p_kilometraje,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), v_alerta, p_client_uuid
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

  if v_alerta then
    select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
      format('Consumo anormal en %s: %s km/gal (%s%% bajo el %s de %s km/gal). Posible fuga, problema mecánico o combustible desviado.',
        coalesce(v_placa,'vehículo'), v_rendimiento,
        round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100),
        case v_ref_tipo when 'esperado' then 'rendimiento esperado' else 'promedio del vehículo' end,
        round(v_ref_valor, 2)),
      'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Consumo anormal de combustible',
      format('%s registró %s km/gal, bajo el %s.', coalesce(v_placa,'Un vehículo'), v_rendimiento,
        case v_ref_tipo when 'esperado' then 'rendimiento esperado' else 'promedio del vehículo' end),
      '/flota/combustible');
  end if;

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'promedio_rendimiento', case when v_n_prev >= 3 then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo
  );
end;
$$;

grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, int, numeric, numeric, text, text, text, text
) to authenticated, service_role;
