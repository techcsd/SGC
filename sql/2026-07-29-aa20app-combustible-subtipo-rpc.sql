-- ============================================================================
-- AA20-app — registrar_combustible_app acepta p_subtipo (regular|premium)
-- PROMPT-10 · FASE 8 · aditivo. Patch programático (solo firma + INSERT).
-- Elimina la sobrecarga vieja de 16 args para evitar ambigüedad de llamadas.
-- ============================================================================

CREATE OR REPLACE FUNCTION sgc.registrar_combustible_app(p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date, p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text DEFAULT NULL::text, p_foto_recibo_path text DEFAULT NULL::text, p_foto_tablero_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_foto_bomba_path text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_tarjeta text DEFAULT NULL::text, p_titular text DEFAULT NULL::text, p_titular_es_persona boolean DEFAULT false, p_subtipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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
  v_umbral       numeric;
  v_esperado     numeric;
  v_prom_flota   numeric;
  v_piso         numeric;
  v_ref_valor    numeric;
  v_ref_tipo     text;
  v_alerta       boolean := false;
  v_motivo       text;
  v_placa        text;
  v_es_prueba    boolean := false;
  v_medida       text := 'km';   -- AA18.3
  v_uni          text := 'km';   -- AA18.3 — unidad del odómetro
  v_ren          text := 'km/gal'; -- AA18.3 — unidad de rendimiento
  v_persona      boolean := coalesce(p_titular_es_persona, false) or p_vehiculo_id is null;  -- Z23-app
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

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

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
        p_kilometraje, v_uni, v_odometro, v_uni
        using errcode = '23514';
    end if;

    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = false;

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        v_costo_km    := round(p_monto / v_km_recorridos, 2);
      end if;
    end if;

    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

    select count(*), avg(rendimiento_km_gal)
      into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = false;

    select avg(rendimiento_km_gal) into v_prom_flota
      from sgc.registros_combustible
     where rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = false;

    select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
    v_umbral := coalesce(v_umbral, 20);

    select valor into v_piso from sgc.flota_config where clave = 'rendimiento_minimo_km_gal';
    v_piso := coalesce(v_piso, 10);

    if v_rendimiento is not null and coalesce(v_km_recorridos, 0) > 0 then
      if v_esperado is not null and v_esperado > 0
         and v_rendimiento < (1 - v_umbral / 100.0) * v_esperado then
        v_alerta := true; v_ref_tipo := 'esperado'; v_ref_valor := v_esperado;
      elsif v_n_prev >= 3 and v_prom is not null
         and v_rendimiento < (1 - v_umbral / 100.0) * v_prom then
        v_alerta := true; v_ref_tipo := 'propio'; v_ref_valor := v_prom;
      end if;

      if v_rendimiento < v_piso and v_medida <> 'horas' then
        -- El "piso" de 10 km/gal solo aplica a vehículos por km.
        v_alerta := true;
        if v_ref_tipo is null then v_ref_tipo := 'piso'; v_ref_valor := v_piso; end if;
      end if;

      if v_alerta then
        v_motivo := case v_ref_tipo
          when 'esperado' then format('Rinde %s %s, %s%% bajo el rendimiento esperado (%s %s).',
            v_rendimiento, v_ren, round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100), round(v_ref_valor,2), v_ren)
          when 'propio' then format('Rinde %s %s, %s%% bajo el promedio del vehículo (%s %s).',
            v_rendimiento, v_ren, round((1 - v_rendimiento / nullif(v_ref_valor,0)) * 100), round(v_ref_valor,2), v_ren)
          else format('Rendimiento imposiblemente bajo: %s %s (mínimo coherente %s %s).',
            v_rendimiento, v_ren, round(v_piso,2), v_ren)
        end;
      end if;
    end if;
  end if;

  v_precio := round(p_monto / p_galones, 2);

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, foto_bomba_path,
    alerta_consumo, motivo_alerta, client_uuid,
    producto, subtipo, tarjeta, titular, titular_es_persona
  ) values (
    v_id,
    case when v_persona then null else p_vehiculo_id end,
    p_conductor_id, coalesce(p_fecha, current_date),
    case when v_persona then null else p_kilometraje end,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, p_client_uuid,
    nullif(p_producto,''), nullif(p_subtipo,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false)
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
    'motivo_alerta', v_motivo,
    'promedio_rendimiento', case when v_n_prev >= 3 then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona
  );
end;
$function$


drop function if exists sgc.registrar_combustible_app(uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text, text, text, text, boolean);
