-- ============================================================================
-- VERIFICACIÓN-TOTAL — cierre de la regla global T2/R6: los datos de prueba
-- (es_prueba=true) NO deben contaminar los agregados de dashboards/analítica.
-- ----------------------------------------------------------------------------
-- Hallazgo del INFORME-VERIFICACION (§4 regla 6): registrar_combustible_app es
-- SECURITY DEFINER, así que BYPASEA la RLS restrictiva de es_prueba
-- (2026-07-22-t2b-enforcement-rls.sql). Sus dos promedios de referencia
-- (promedio propio del vehículo y promedio de flota) leían registros_combustible
-- SIN excluir es_prueba → las echadas de prueba desviaban la referencia de
-- anomalía de consumo (T5/U10).
--
-- Fix: agregar `and coalesce(es_prueba, false) = false` a los DOS subqueries de
-- promedio. Idéntico a 2026-07-22-u10-piso-consumo.sql en todo lo demás (misma
-- firma, misma cascada esperado→propio→piso). Aditivo/retrocompatible.
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
  v_piso         numeric;   -- U10 — piso absoluto de coherencia (km/gal)
  v_ref_valor    numeric;   -- referencia contra la que se disparó
  v_ref_tipo     text;      -- 'esperado' | 'propio' | 'piso' | null
  v_alerta       boolean := false;
  v_motivo       text;      -- U10 — motivo legible del disparo
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

  -- VERIF: excluir datos de prueba del promedio propio (DEFINER bypasea la RLS).
  select count(*), avg(rendimiento_km_gal)
    into v_n_prev, v_prom
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
     and coalesce(es_prueba, false) = false;

  -- VERIF: excluir datos de prueba del promedio de flota.
  select avg(rendimiento_km_gal) into v_prom_flota
    from sgc.registros_combustible
   where rendimiento_km_gal is not null
     and coalesce(es_prueba, false) = false;

  select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
  v_umbral := coalesce(v_umbral, 20);

  select valor into v_piso from sgc.flota_config where clave = 'rendimiento_minimo_km_gal';
  v_piso := coalesce(v_piso, 10);

  -- Cascada de evaluación (solo con rendimiento calculable y km recorridos > 0).
  -- La referencia que dispara define el motivo; el piso absoluto es el respaldo
  -- final y garantiza que un rendimiento imposiblemente bajo SIEMPRE alerte.
  if v_rendimiento is not null and coalesce(v_km_recorridos, 0) > 0 then
    -- (1) rendimiento esperado
    if v_esperado is not null and v_esperado > 0
       and v_rendimiento < (1 - v_umbral / 100.0) * v_esperado then
      v_alerta := true; v_ref_tipo := 'esperado'; v_ref_valor := v_esperado;
    -- (2) promedio propio del vehículo
    elsif v_n_prev >= 3 and v_prom is not null
       and v_rendimiento < (1 - v_umbral / 100.0) * v_prom then
      v_alerta := true; v_ref_tipo := 'propio'; v_ref_valor := v_prom;
    end if;

    -- (3) PISO ABSOLUTO — dispara SIEMPRE si cae por debajo, aun sin (1)/(2).
    if v_rendimiento < v_piso then
      v_alerta := true;
      if v_ref_tipo is null then v_ref_tipo := 'piso'; v_ref_valor := v_piso; end if;
    end if;

    -- Motivo legible según lo que disparó.
    if v_alerta then
      v_motivo := case v_ref_tipo
        when 'esperado' then format('Rinde %s km/gal, %s%% bajo el rendimiento esperado (%s km/gal).',
          v_rendimiento, round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100), round(v_ref_valor,2))
        when 'propio' then format('Rinde %s km/gal, %s%% bajo el promedio del vehículo (%s km/gal).',
          v_rendimiento, round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100), round(v_ref_valor,2))
        else format('Rendimiento imposiblemente bajo: %s km/gal (mínimo coherente %s km/gal).',
          v_rendimiento, round(v_piso,2))
      end;
    end if;
  end if;

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, alerta_consumo, motivo_alerta, client_uuid
  ) values (
    v_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), p_kilometraje,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), v_alerta, v_motivo, p_client_uuid
  );

  perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

  if v_alerta then
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

  return jsonb_build_object(
    'id', v_id,
    'precio_por_galon', v_precio,
    'km_anterior', v_km_anterior,
    'km_recorridos', v_km_recorridos,
    'rendimiento_km_gal', v_rendimiento,
    'costo_por_km', v_costo_km,
    'alerta_consumo', v_alerta,
    'motivo_alerta', v_motivo,
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
