-- ============================================================================
-- AW3 — RPCs de combustible: validación en servidor, saneamiento y exclusión
-- Requiere 2026-08-24-aw3-combustible-validacion.sql (parte 1).
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────
-- registrar_combustible_app — + p_confirmado, tope duro, confirmación de
-- valores inusuales, banda de precio, exclusión de invalidadas del baseline,
-- y aviso con DIRECCIÓN (bajo→mantenimiento · alto→revisar lectura).
-- ADITIVO: p_confirmado es el último parámetro con DEFAULT (app vieja intacta).
-- ────────────────────────────────────────────────────────────────────────
create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric,
  p_estacion text default null, p_foto_recibo_path text default null,
  p_foto_tablero_path text default null, p_notas text default null,
  p_foto_bomba_path text default null, p_producto text default null,
  p_tarjeta text default null, p_titular text default null,
  p_titular_es_persona boolean default false, p_subtipo text default null,
  p_origen text default 'estacion', p_proyecto_id uuid default null,
  p_confirmado boolean default false)
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
  v_direccion    text;
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
  v_asignado     uuid;
  v_umbral_km    numeric;
  v_km_alerta    boolean := false;
  -- AW3
  v_cap          numeric;
  v_margen_bloq  numeric;
  v_margen_al    numeric;
  v_precio_calc  numeric;
  v_precio_min   numeric;
  v_precio_max   numeric;
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

  -- AW3 — TOPE DURO de galones (integridad; el cliente valida por UX).
  v_margen_bloq := coalesce((select valor from sgc.flota_config where clave='tanque_margen_bloqueo'), 1.15);
  v_margen_al   := coalesce((select valor from sgc.flota_config where clave='tanque_margen_alerta'), 0.85);
  if v_persona then
    v_cap := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
  else
    v_cap := sgc.cap_tanque_vehiculo(p_vehiculo_id);
  end if;
  if v_cap is not null and v_cap > 0 and p_galones > v_cap * v_margen_bloq then
    raise exception 'La cantidad de galones (%) supera la capacidad estimada del % (~% gal). Verifica el valor — ¿sobró un punto o coma?',
      round(p_galones,2),
      case when v_persona then 'depósito' else 'tanque de este vehículo' end,
      round(v_cap,0)
      using errcode = '23514';
  end if;

  -- AW3 — banda de precio por galón (bloquea 34,118 gal por partida doble).
  if coalesce(p_monto,0) > 0 and p_galones > 0 then
    v_precio_calc := p_monto / p_galones;
    v_precio_min  := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
    v_precio_max  := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
    if v_precio_calc < v_precio_min or v_precio_calc > v_precio_max then
      raise exception 'El precio por galón resultante (RD$%) está fuera de la banda plausible (RD$%–RD$%). Revisa los galones y el monto.',
        round(v_precio_calc,2), round(v_precio_min,0), round(v_precio_max,0)
        using errcode = '23514';
    end if;
  end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

    -- AF18 — solo el usuario asignado registra en su vehículo (bypass admin).
    if not sgc.is_admin() then
      select coalesce(a.usuario_id, c.usuario_id)
        into v_asignado
        from sgc.vehiculo_asignaciones a
        left join sgc.conductores c on c.id = a.conductor_id
       where a.vehiculo_id = p_vehiculo_id and a.activa
       order by a.desde desc nulls last
       limit 1;
      if v_asignado is null then
        select responsable_id into v_asignado from sgc.vehiculos where id = p_vehiculo_id;
      end if;
      if v_asignado is not null and v_asignado <> v_uid then
        raise exception 'Solo el usuario asignado a este vehículo puede registrar su combustible.'
          using errcode = '42501';
      end if;
    end if;

    select coalesce(es_prueba, false), coalesce(kilometraje, 0), coalesce(medida_uso, 'km'), placa
      into v_es_prueba, v_odometro, v_medida, v_placa
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

    -- La echada anterior (excluye invalidadas para no arrastrar km corruptos).
    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false);

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;

      -- AF19 — salto de km entre echadas.
      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          if sgc.is_admin() then
            v_km_alerta := true;
          else
            raise exception 'El salto de kilometraje (% km desde la última echada) supera el máximo permitido (% km). Verifica la lectura del odómetro.',
              v_km_recorridos, v_umbral_km using errcode = '23514';
          end if;
        end if;
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

    -- Baseline propio: excluye invalidadas (AW3) y datos de otro contexto es_prueba.
    select count(*), avg(rendimiento_km_gal) into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    select avg(rendimiento_km_gal) into v_prom_flota
      from sgc.registros_combustible
     where rendimiento_km_gal is not null and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n_prev >= v_min_reg then v_prom else null end;
    v_ref_tipo := case when v_esperado is not null and v_esperado > 0 then 'esperado'
                       when v_n_prev >= v_min_reg then 'propio' else null end;
    v_ref_valor := v_baseline;

    select estado, motivo, direccion into v_estado, v_motivo, v_direccion
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true);
    v_alerta := (v_estado = 'anormal');
  end if;

  -- AW3 — confirmación de valores inusuales (soft): valor alto pero no imposible.
  -- No inserta; el cliente re-llama con p_confirmado=true (mismo client_uuid).
  if not coalesce(p_confirmado, false)
     and v_cap is not null and v_cap > 0
     and p_galones > v_cap * v_margen_al then
    return jsonb_build_object(
      'needs_confirm', true,
      'confirm_message', format('%s galones es más de lo habitual para %s (tanque ≈ %s gal). ¿Confirmas la cantidad?',
        trim(to_char(p_galones,'FM999990.00')),
        coalesce(v_placa, 'este destino'), round(v_cap,0)),
      'cap', v_cap, 'galones', p_galones);
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
    origen, proyecto_id, registrado_por, km_alerta
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
    v_origen, p_proyecto_id, v_uid, v_km_alerta
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    -- AW2 — aviso CON DIRECCIÓN:
    --  · bajo  → problema mecánico/fuga/desvío → ticket a mantenimiento (Flota).
    --  · alto  → error de dato (echada previa sin registrar, km/galones mal) →
    --            pedir revisar la lectura a quien registró + supervisores; NO mantenimiento.
    if v_alerta and not v_es_prueba then
      if v_direccion = 'alto' then
        insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
        values ('revisar_lectura', p_vehiculo_id, p_conductor_id, v_id,
          format('Posible error de lectura en %s: %s No es falla mecánica: verifica el odómetro y los galones.',
            coalesce(v_placa,'vehículo'), v_motivo),
          'media');
        perform sgc.notificar(v_uid, 'revisar_lectura', 'Revisa la lectura de tu echada',
          format('%s: %s', coalesce(v_placa,'Vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text);
        perform sgc.notificar_flota_elevado('revisar_lectura',
          'Echada con rendimiento inusualmente alto',
          format('%s: %s Revisar la lectura (no es ticket de mantenimiento).', coalesce(v_placa,'Un vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text);
      else
        insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
        values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
          format('Consumo anormal en %s: %s Posible fuga, problema mecánico o combustible desviado.',
            coalesce(v_placa,'vehículo'), v_motivo),
          'alta');
        perform sgc.notificar_modulo('flota', 'consumo_anormal',
          'Consumo anormal de combustible',
          format('%s: %s', coalesce(v_placa,'Un vehículo'), v_motivo),
          '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
      end if;
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
    'direccion_alerta', v_direccion,
    'km_alerta', v_km_alerta,
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

-- ────────────────────────────────────────────────────────────────────────
-- recalcular_estados_combustible — excluye invalidadas del baseline y del recálculo.
-- ────────────────────────────────────────────────────────────────────────
create or replace function sgc.recalcular_estados_combustible()
 returns integer
 language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_count int := 0; r record;
  v_medida text; v_esperado numeric; v_baseline numeric; v_n int; v_prom numeric;
  v_dist_min numeric; v_piso_c numeric; v_techo_c numeric; v_min_reg int;
  v_estado text; v_motivo text; v_dir text; v_ep boolean;
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador puede recalcular el histórico'; end if;
  for r in
    select id, vehiculo_id, km_recorridos, galones, rendimiento_km_gal, coalesce(es_prueba,false) as ep
      from sgc.registros_combustible
     where vehiculo_id is not null and not coalesce(invalidada, false)
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
       and not coalesce(invalidada, false)
       and km_recorridos >= v_dist_min
       and rendimiento_km_gal between v_piso_c and v_techo_c;

    v_baseline := case when v_esperado is not null and v_esperado > 0 then v_esperado
                       when v_n >= v_min_reg then v_prom else null end;

    select estado, motivo, direccion into v_estado, v_motivo, v_dir
      from sgc.clasificar_rendimiento(v_medida, r.km_recorridos, r.galones, r.rendimiento_km_gal, v_baseline, true);

    update sgc.registros_combustible
       set estado = v_estado, motivo_alerta = v_motivo, alerta_consumo = (v_estado = 'anormal')
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- ────────────────────────────────────────────────────────────────────────
-- sanear_echada — corregir / invalidar / revalidar una echada (admin), con
-- traza (valor_original) y recálculo del histórico. Nunca borra (AU18).
-- ────────────────────────────────────────────────────────────────────────
create or replace function sgc.sanear_echada(
  p_id uuid, p_accion text, p_galones numeric default null,
  p_monto numeric default null, p_kilometraje integer default null,
  p_motivo text default null)
 returns jsonb
 language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_row sgc.registros_combustible%rowtype; v_uid uuid := auth.uid();
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede sanear echadas' using errcode = '42501';
  end if;
  select * into v_row from sgc.registros_combustible where id = p_id;
  if not found then raise exception 'Echada no encontrada'; end if;

  if p_accion = 'invalidar' then
    update sgc.registros_combustible
       set invalidada = true, saneada = true,
           saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Excluida por dato inválido'),
           saneada_por = v_uid, saneada_at = now(),
           valor_original = coalesce(valor_original, to_jsonb(v_row))
     where id = p_id;

  elsif p_accion = 'revalidar' then
    update sgc.registros_combustible
       set invalidada = false, saneada = true,
           saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Revalidada'),
           saneada_por = v_uid, saneada_at = now()
     where id = p_id;

  elsif p_accion = 'corregir' then
    -- 1) Guarda original + aplica valores nuevos (los no provistos quedan igual).
    update sgc.registros_combustible
       set valor_original = coalesce(valor_original, to_jsonb(v_row)),
           galones     = coalesce(p_galones, galones),
           monto       = coalesce(p_monto, monto),
           kilometraje = coalesce(p_kilometraje, kilometraje),
           precio_por_galon = case
             when coalesce(p_monto, monto) > 0 and coalesce(p_galones, galones) > 0
             then round(coalesce(p_monto, monto) / coalesce(p_galones, galones), 2)
             else precio_por_galon end,
           invalidada = false, saneada = true,
           saneamiento_motivo = coalesce(nullif(trim(p_motivo),''), 'Corregida'),
           saneada_por = v_uid, saneada_at = now()
     where id = p_id;
    -- 2) Recalcula km_recorridos (si cambió el kilometraje) y los derivados.
    update sgc.registros_combustible r
       set km_recorridos = case
             when r.km_anterior is not null and r.kilometraje is not null and r.kilometraje > r.km_anterior
             then r.kilometraje - r.km_anterior else r.km_recorridos end
     where r.id = p_id;
    update sgc.registros_combustible r
       set rendimiento_km_gal = case
             when coalesce(r.km_recorridos,0) > 0 and coalesce(r.galones,0) > 0
             then round(r.km_recorridos::numeric / r.galones, 2) else null end,
           costo_por_km = case
             when coalesce(r.km_recorridos,0) > 0 and coalesce(r.monto,0) > 0
             then round(r.monto / r.km_recorridos, 2) else null end
     where r.id = p_id;

  else
    raise exception 'Acción no válida: % (usa corregir | invalidar | revalidar)', p_accion;
  end if;

  -- Recalcula estados de todo el histórico (baselines cambian al excluir/corregir).
  perform sgc.recalcular_estados_combustible();

  select * into v_row from sgc.registros_combustible where id = p_id;
  return to_jsonb(v_row);
end;
$function$;
grant execute on function sgc.sanear_echada(uuid,text,numeric,numeric,integer,text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- echadas_sospechosas — lista para el panel de saneamiento (admin). Marca
-- cada echada con los motivos por los que se considera sospechosa.
-- ────────────────────────────────────────────────────────────────────────
create or replace function sgc.echadas_sospechosas()
 returns jsonb
 language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_pmin numeric := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
  v_pmax numeric := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
  v_rmin numeric := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
  v_rmax numeric := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
  v_capnv numeric := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
begin
  if not sgc.is_admin() then raise exception 'Solo un administrador' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.fecha desc)
    from (
      select r.id, r.fecha, r.vehiculo_id, v.placa, v.marca, v.tipo,
             r.galones, r.monto, r.precio_por_galon, r.kilometraje, r.km_recorridos,
             r.rendimiento_km_gal, r.estado, r.es_prueba, r.invalidada,
             case when r.vehiculo_id is not null then sgc.cap_tanque_vehiculo(r.vehiculo_id) else v_capnv end as cap,
             (select array_agg(m) from unnest(array_remove(array[
                case when r.vehiculo_id is not null and r.galones > sgc.cap_tanque_vehiculo(r.vehiculo_id)
                     then 'Galones sobre la capacidad de tanque' end,
                case when r.vehiculo_id is null and r.galones > v_capnv
                     then 'Galones sobre el tope de depósito' end,
                case when coalesce(r.monto,0) > 0 and r.precio_por_galon is not null
                          and (r.precio_por_galon < v_pmin or r.precio_por_galon > v_pmax)
                     then 'Precio/galón fuera de banda' end,
                case when r.rendimiento_km_gal is not null and r.rendimiento_km_gal > v_rmax
                     then 'Rendimiento imposiblemente alto (error de dato)' end,
                case when r.rendimiento_km_gal is not null and r.km_recorridos is not null
                          and r.rendimiento_km_gal < v_rmin
                     then 'Rendimiento imposiblemente bajo' end
              ], null)) ) as motivos
      from sgc.registros_combustible r
      left join sgc.vehiculos v on v.id = r.vehiculo_id
      where not coalesce(r.invalidada, false)
        and (
          (r.vehiculo_id is not null and r.galones > sgc.cap_tanque_vehiculo(r.vehiculo_id)) or
          (r.vehiculo_id is null and r.galones > v_capnv) or
          (coalesce(r.monto,0) > 0 and r.precio_por_galon is not null
             and (r.precio_por_galon < v_pmin or r.precio_por_galon > v_pmax)) or
          (r.rendimiento_km_gal is not null and r.rendimiento_km_gal > v_rmax) or
          (r.rendimiento_km_gal is not null and r.km_recorridos is not null and r.rendimiento_km_gal < v_rmin)
        )
    ) x
  ), '[]'::jsonb);
end;
$function$;
grant execute on function sgc.echadas_sospechosas() to authenticated;

commit;
