-- ============================================================================
-- Z23-app (follow-up) — Echada de tarjeta-persona SIN vehículo
-- PROMPT-7 · FASE 4 · ADITIVO / RETROCOMPATIBLE
-- ============================================================================
-- Hoy registrar_combustible_app exige p_vehiculo_id (2º param sin default) y el
-- cuerpo bloquea vehículos inexistentes/inactivos, avanza el odómetro y calcula
-- rendimiento. Las tarjetas asignadas a una PERSONA (no a un vehículo) no tienen
-- odómetro ni rendimiento; ya se conciliaban por tarjeta/titular
-- (combustible_transacciones_proveedor matchea numero_tarjeta/titular/producto,
-- NO por vehiculo_id), así que soportar una echada sin vehículo es aditivo y no
-- toca la conciliación ni ninguna FK (la FK vehiculo_id→vehiculos admite NULL).
--
-- Esta migración:
--   1) Hace vehiculo_id y kilometraje NULLABLE (defensivo: si ya lo son, no-op).
--   2) CREATE OR REPLACE del RPC (misma firma de 16 params) con una RAMA de
--      persona: cuando p_titular_es_persona=true (o p_vehiculo_id IS NULL) se
--      salta la validación de vehículo, el odómetro, el rendimiento y la alerta,
--      e inserta la fila con vehiculo_id/kilometraje/km_* en NULL. El camino de
--      vehículo queda EXACTAMENTE igual → clientes viejos no cambian.
--
-- Efectos colaterales verificados como seguros:
--   • Vistas de flota que agrupan por vehiculo_id (2026-07-14-mejoras-flota.sql,
--     2026-07-24-y5y9-...) excluyen filas con vehiculo_id NULL (no error).
--   • getUltimaEchada / RPCs de rendimiento filtran `where vehiculo_id = ...`
--     → una echada de persona no afecta las estadísticas de ningún vehículo.
--   • Limpieza de datos de prueba por vehiculo_id no barre estas filas (esperado;
--     una echada de persona no cuelga de un vehículo).
--
-- NO APLICADA — la aplica Xavier.
-- ============================================================================

-- 1) Columnas nullable (defensivo). ------------------------------------------
do $$ begin
  alter table sgc.registros_combustible alter column vehiculo_id drop not null;
exception when others then null; end $$;
do $$ begin
  alter table sgc.registros_combustible alter column kilometraje drop not null;
exception when others then null; end $$;

-- 2) RPC con rama de persona (misma firma de 16 params → reemplaza in situ). ---
create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid,
  p_vehiculo_id uuid,
  p_conductor_id uuid,
  p_fecha date,
  p_kilometraje integer,
  p_galones numeric,
  p_monto numeric,
  p_estacion text default null::text,
  p_foto_recibo_path text default null::text,
  p_foto_tablero_path text default null::text,
  p_notas text default null::text,
  p_foto_bomba_path text default null::text,
  p_producto text default null::text,
  p_tarjeta text default null::text,
  p_titular text default null::text,
  p_titular_es_persona boolean default false
)
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

  -- Validaciones comunes (aplican a vehículo y a persona).
  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  -- Z23-app — la echada de persona salta TODA la lógica de vehículo/odómetro.
  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;
    select coalesce(es_prueba, false), coalesce(kilometraje, 0)
      into v_es_prueba, v_odometro
      from sgc.vehiculos where id = p_vehiculo_id;

    if coalesce(p_kilometraje, 0) <= 0 then raise exception 'El kilometraje debe ser mayor que 0'; end if;

    if p_kilometraje < v_odometro then
      raise exception 'El kilometraje (% km) no puede ser menor al odómetro actual del vehículo (% km).',
        p_kilometraje, v_odometro
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

      if v_rendimiento < v_piso then
        v_alerta := true;
        if v_ref_tipo is null then v_ref_tipo := 'piso'; v_ref_valor := v_piso; end if;
      end if;

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
  end if;

  v_precio := round(p_monto / p_galones, 2);

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, foto_bomba_path,
    alerta_consumo, motivo_alerta, client_uuid,
    producto, tarjeta, titular, titular_es_persona
  ) values (
    v_id,
    case when v_persona then null else p_vehiculo_id end,          -- Z23-app
    p_conductor_id, coalesce(p_fecha, current_date),
    case when v_persona then null else p_kilometraje end,          -- Z23-app
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, p_client_uuid,
    nullif(p_producto,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false)
  );

  -- Z23-app — solo un vehículo tiene odómetro que avanzar y consumo que vigilar.
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
    'titular_es_persona', v_persona
  );
end;
$function$;

grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean
) to authenticated, service_role;
