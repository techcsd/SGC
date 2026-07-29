-- ============================================================================
-- Z23-app — Extensión del contrato de "echada de combustible" para conciliación
-- PROMPT-7 · FASE 4 · ADITIVO y RETROCOMPATIBLE
-- ============================================================================
-- La app (csd-app) necesita capturar en cada echada: producto (diesel/gasolina),
-- tarjeta y, para tarjetas asignadas a una PERSONA (no vehículo), el titular.
-- Estos campos son los que permiten conciliar contra el reporte del proveedor
-- (combustible_transacciones_proveedor: producto / numero_tarjeta / titular).
--
-- Esta migración:
--   1) Añade columnas nullable a sgc.registros_combustible (no rompe nada).
--   2) CREATE OR REPLACE del RPC registrar_combustible_app AÑADIENDO 4 params
--      opcionales al final (defaults null/false → clientes viejos siguen igual)
--      y persistiéndolos. El resto del cuerpo queda EXACTAMENTE igual.
--
-- REVISAR ANTES DE APLICAR. No aplicada a producción por Claude Code.
-- Regla #5 (SGC): al aplicar, exponer producto/tarjeta en las vistas web de
-- combustible (detalle de echada + reporte de conciliación).
-- ============================================================================

-- 1) Columnas aditivas -------------------------------------------------------
alter table sgc.registros_combustible
  add column if not exists producto           text,               -- 'diesel' | 'gasolina'
  add column if not exists tarjeta            text,               -- número/identificador de tarjeta
  add column if not exists titular            text,               -- titular de la tarjeta (persona o vehículo)
  add column if not exists titular_es_persona boolean not null default false;

comment on column sgc.registros_combustible.producto is 'Tipo de combustible: diesel | gasolina (para conciliar con el reporte del proveedor).';
comment on column sgc.registros_combustible.tarjeta is 'Tarjeta usada en la echada (clave de conciliación con combustible_transacciones_proveedor.numero_tarjeta).';
comment on column sgc.registros_combustible.titular_es_persona is 'true si la tarjeta está asignada a una persona (no a un vehículo).';

-- 2) RPC extendido -----------------------------------------------------------
-- Firma: se AÑADEN al final p_producto, p_tarjeta, p_titular, p_titular_es_persona.
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
  select coalesce(es_prueba, false), coalesce(kilometraje, 0)
    into v_es_prueba, v_odometro
    from sgc.vehiculos where id = p_vehiculo_id;

  if coalesce(p_kilometraje, 0) <= 0 then raise exception 'El kilometraje debe ser mayor que 0'; end if;
  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if coalesce(p_monto, 0)   <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  if p_kilometraje < v_odometro then
    raise exception 'El kilometraje (% km) no puede ser menor al odómetro actual del vehículo (% km).',
      p_kilometraje, v_odometro
      using errcode = '23514';
  end if;

  select max(kilometraje) into v_km_anterior
    from sgc.registros_combustible
   where vehiculo_id = p_vehiculo_id and kilometraje is not null
     and coalesce(es_prueba, false) = false;

  v_precio := round(p_monto / p_galones, 2);

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

  v_id := coalesce(p_client_uuid, gen_random_uuid());
  insert into sgc.registros_combustible (
    id, vehiculo_id, conductor_id, fecha, kilometraje, galones, monto,
    precio_por_galon, km_anterior, km_recorridos, rendimiento_km_gal, costo_por_km,
    estacion, notas, foto_recibo_path, foto_tablero_path, foto_bomba_path,
    alerta_consumo, motivo_alerta, client_uuid,
    producto, tarjeta, titular, titular_es_persona                 -- Z23-app (aditivo)
  ) values (
    v_id, p_vehiculo_id, p_conductor_id, coalesce(p_fecha, current_date), p_kilometraje,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, p_client_uuid,
    nullif(p_producto,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false)
  );

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
    'odometro', v_odometro
  );
end;
$function$;

-- IMPORTANTE: como la firma nueva tiene MÁS parámetros, el CREATE OR REPLACE
-- de arriba crea una SEGUNDA sobrecarga en vez de reemplazar. Hay que eliminar
-- la firma vieja (12 params) o las llamadas con nombres quedan ambiguas
-- ("function is not unique") y rompe combustible. Se elimina aquí:
drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text
);

grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean
) to authenticated, service_role;
