-- sql/2026-11-03-di4b-fix-overload-registrar-combustible.sql — Ronda DI, corrección
--
-- F0 de esta ronda leyó mal el estado de partida: el script de diagnóstico solo
-- imprimía la PRIMERA fila de `pg_get_functiondef` y `registrar_combustible_app`
-- ya tenía 2 overloads potenciales en juego (DH2 —ronda anterior, ya en
-- origin/dev— había agregado `p_km_forzar`/`p_km_motivo`, 24 args). Las
-- migraciones DI5 (2026-11-03-di5-combustible-captura.sql) y DI4
-- (2026-11-03-di4-tarjeta-cupo.sql) asumieron una base de 22 args (sin DH2) y
-- dejaron DOS funciones de 24 args coexistiendo (DH2 por un lado, DI5/DI4 por
-- otro) — overload ambiguo real en dev. Esta migración los funde en UNA sola
-- función de 26 args (DH2 + DI5/DI4 juntos) y corrige dos bugs de columnas
-- ambiguas en las funciones de cupo de tarjeta (DI4) descubiertos al probar.
--
-- node scripts/apply-migration.mjs sql/2026-11-03-di4b-fix-overload-registrar-combustible.sql --env dev

-- ── 1) Fundir los dos overloads de 24 args en uno de 26 ───────────────────────
drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean, text, text, uuid, boolean, text, text, boolean, text
);
drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean, text, text, uuid, boolean, text, text, text, jsonb
);

create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric,
  p_estacion text default null, p_foto_recibo_path text default null,
  p_foto_tablero_path text default null, p_notas text default null,
  p_foto_bomba_path text default null, p_producto text default null,
  p_tarjeta text default null, p_titular text default null,
  p_titular_es_persona boolean default false, p_subtipo text default null,
  p_origen text default 'estacion', p_proyecto_id uuid default null,
  p_confirmado boolean default false, p_foto_origen text default 'camara',
  p_numero_recibo text default null,
  p_km_forzar boolean default false, p_km_motivo text default null,
  p_captura text default 'normal',
  p_diferencias jsonb default null
)
returns jsonb
language plpgsql security definer
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
  v_sin_asignacion boolean := false;   -- BR1
  v_km_base      int;                   -- BR1
  v_elevado_conf boolean;               -- BR1
  -- AW3
  v_cap          numeric;
  v_margen_bloq  numeric;
  v_margen_al    numeric;
  v_precio_calc  numeric;
  v_precio_min   numeric;
  v_precio_max   numeric;
  v_foto_origen  text := case when lower(coalesce(p_foto_origen,'camara')) in ('galeria','galería') then 'galeria' else 'camara' end;  -- CK3
  v_numero_recibo text := nullif(regexp_replace(coalesce(p_numero_recibo,''), '[^0-9]', '', 'g'), ''); -- CO15
  v_validacion_km jsonb; -- CZ1
  -- DI5/DI6
  v_captura        text := case when lower(coalesce(p_captura,'normal')) = 'rapido_ia' then 'rapido_ia' else 'normal' end;
  v_sin_foto_bomba boolean;
  v_exige_bomba    boolean;
  v_diferencia_marcada boolean := false;
  -- DI4 — alerta de cupo de tarjeta
  v_tarjeta_norm text := nullif(trim(p_tarjeta), '');
  v_consumo      record;
  v_alerta_id    uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  if coalesce(p_fecha, current_date) > current_date then
    raise exception 'La fecha de la echada no puede ser futura.'
      using errcode = '22023', detail = 'campo=fecha;motivo=futura';
  end if;
  if coalesce(p_fecha, current_date) < current_date
     and not sgc.puede_registrar_combustible_retro(v_uid, coalesce(p_fecha, current_date)) then
    raise exception 'No puedes registrar una echada con fecha pasada (%). Pide a Flota un permiso de registro retroactivo.', p_fecha
      using errcode = '22023', detail = 'campo=fecha;motivo=retroactiva_sin_permiso';
  end if;

  v_elevado_conf := sgc.es_flota_elevado() and coalesce(p_confirmado, false);  -- BR1

  if v_origen not in ('estacion','deposito_obra') then v_origen := 'estacion'; end if;
  v_deposito := (v_origen = 'deposito_obra');
  if v_deposito then v_persona := false; end if;

  select id into v_id from sgc.registros_combustible where client_uuid = p_client_uuid;
  if v_id is not null then
    return (select to_jsonb(r) from sgc.registros_combustible r where r.id = v_id);
  end if;

  if v_numero_recibo is not null and not v_persona then
    select id into v_id from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and numero_recibo = v_numero_recibo
       and not coalesce(invalidada, false)
     limit 1;
    if v_id is not null then
      return (select to_jsonb(r) || jsonb_build_object('duplicado', true)
                from sgc.registros_combustible r where r.id = v_id);
    end if;
  end if;

  select id into v_id from sgc.registros_combustible
   where registrado_por = v_uid
     and coalesce(vehiculo_id::text,'') = coalesce((case when v_persona then null else p_vehiculo_id end)::text,'')
     and galones = p_galones
     and coalesce(monto,0) = coalesce(nullif(p_monto,0),0)
     and created_at > now() - interval '120 seconds'
   order by created_at asc
   limit 1;
  if v_id is not null then
    return (select to_jsonb(r) || jsonb_build_object('duplicado', true)
              from sgc.registros_combustible r where r.id = v_id);
  end if;

  if p_conductor_id is not null
     and not exists (select 1 from sgc.conductores c where c.id = p_conductor_id) then
    raise notice 'registrar_combustible_app: conductor_id % del payload no existe (fusionado/borrado) — ignorado, se resuelve por uid', p_conductor_id;
    p_conductor_id := null;
  end if;
  if p_conductor_id is null then
    select c.id into p_conductor_id from sgc.conductores c where c.usuario_id = v_uid limit 1;
  end if;
  if p_conductor_id is null and p_vehiculo_id is not null then
    select a.conductor_id into p_conductor_id
      from sgc.vehiculo_asignaciones a
     where a.vehiculo_id = p_vehiculo_id and a.activa
     order by a.desde desc nulls last
     limit 1;
  end if;

  if coalesce(p_galones, 0) <= 0 then raise exception 'Los galones deben ser mayores que 0'; end if;
  if not v_deposito and coalesce(p_monto, 0) <= 0 then raise exception 'El monto debe ser mayor que 0'; end if;

  v_margen_bloq := coalesce((select valor from sgc.flota_config where clave='tanque_margen_bloqueo'), 1.15);
  v_margen_al   := coalesce((select valor from sgc.flota_config where clave='tanque_margen_alerta'), 0.85);
  if v_persona then
    v_cap := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
  else
    v_cap := sgc.cap_tanque_vehiculo(p_vehiculo_id);
  end if;
  if v_cap is not null and v_cap > 0 and p_galones > v_cap * v_margen_bloq
     and not v_elevado_conf then
    perform sgc.error_campo('galones', 'supera_capacidad',
      format('La cantidad de galones (%s) supera la capacidad estimada del %s (~%s gal). Verifica el valor — ¿sobró un punto o coma? Si es correcto, pídele a Logística (Raykler) que la registre.',
        round(p_galones,2),
        case when v_persona then 'depósito' else 'tanque de este vehículo' end,
        round(v_cap,0)));
  end if;

  if coalesce(p_monto,0) > 0 and p_galones > 0 then
    v_precio_calc := p_monto / p_galones;
    v_precio_min  := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
    v_precio_max  := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
    if (v_precio_calc < v_precio_min or v_precio_calc > v_precio_max) and not v_elevado_conf then
      perform sgc.error_campo('monto', 'precio_fuera_banda',
        format('El precio por galón resultante (RD$%s) está fuera de la banda plausible (RD$%s–RD$%s). Revisa los galones y el monto. Si es correcto, pídele a Logística (Raykler) que la registre.',
          round(v_precio_calc,2), round(v_precio_min,0), round(v_precio_max,0)));
    end if;
  end if;

  v_sin_foto_bomba := (v_captura = 'rapido_ia' and p_foto_bomba_path is null and not v_persona and not v_deposito);
  if v_sin_foto_bomba then
    v_exige_bomba := coalesce((select valor from sgc.parametros where clave = 'combustible_rapido_exige_bomba'), 'false') = 'true';
    if v_exige_bomba and not v_elevado_conf then
      perform sgc.error_campo('foto_bomba', 'requerida',
        'Falta la foto de la bomba en 0. Actívala en Flota › Combustible si quieres hacerla opcional.');
    end if;
  end if;

  if p_diferencias is not null and jsonb_typeof(p_diferencias) = 'array' then
    select exists (
      select 1 from jsonb_array_elements(p_diferencias) d
      where d->>'decision' = 'mantener_mio'
    ) into v_diferencia_marcada;
  end if;

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

    if not sgc.es_flota_elevado() then
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
      if v_asignado is not null and v_asignado <> v_uid
         and not exists (
           select 1 from sgc.vehiculo_usos u
            where u.vehiculo_id = p_vehiculo_id and u.usuario_id = v_uid and u.fin_at is null
         ) then
        v_sin_asignacion := true;
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

    -- DH2 — pasa el forzado/motivo (solo tiene efecto si hay choque entre fechas
    -- distintas y el usuario es flota-elevado); mismo día ya es aviso, no bloquea.
    v_validacion_km := sgc.validar_km_vehiculo(p_vehiculo_id, p_kilometraje, coalesce(p_fecha, current_date)::timestamptz, null, p_km_forzar, p_km_motivo);
    if coalesce(v_validacion_km->>'nivel','ok') = 'error' then
      perform sgc.error_campo('kilometraje', 'menor_que_actual', v_validacion_km->>'mensaje');
    end if;

    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false);

    if not v_es_prueba then
      select km_base_combustible into v_km_base from sgc.vehiculos where id = p_vehiculo_id;
      if v_km_base is not null then
        v_km_anterior := greatest(coalesce(v_km_anterior, 0), v_km_base);
      end if;
    end if;

    if v_km_anterior is not null then
      v_km_recorridos := p_kilometraje - v_km_anterior;
      if v_km_recorridos > 0 then
        v_rendimiento := round(v_km_recorridos::numeric / p_galones, 2);
        if coalesce(p_monto,0) > 0 then v_costo_km := round(p_monto / v_km_recorridos, 2); end if;
      end if;

      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          v_km_alerta := true;
        end if;
      end if;
    end if;

    select dist_min, piso, techo into v_dist_min, v_piso_c, v_techo_c
      from sgc.rango_rendimiento_vehiculo(p_vehiculo_id, v_medida);
    v_min_reg := coalesce((select valor from sgc.flota_config where clave='min_registros_baseline'), 3);

    select rendimiento_esperado_km_gal into v_esperado from sgc.vehiculos where id = p_vehiculo_id;

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
      from sgc.clasificar_rendimiento(v_medida, v_km_recorridos, p_galones, v_rendimiento, v_baseline, true, v_piso_c, v_techo_c);
    v_alerta := (v_estado = 'anormal');
  end if;

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
    origen, proyecto_id, registrado_por, km_alerta, sin_asignacion, foto_origen,
    numero_recibo, captura, sin_foto_bomba, diferencias_recibo
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
    nullif(p_producto,''), nullif(p_subtipo,''), v_tarjeta_norm, nullif(p_titular,''), coalesce(p_titular_es_persona,false),
    v_origen, p_proyecto_id, v_uid, v_km_alerta, v_sin_asignacion, v_foto_origen,
    v_numero_recibo, v_captura, v_sin_foto_bomba, p_diferencias
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

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

    if v_km_alerta and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'km_salto',
        'Salto de kilometraje en una echada',
        format('%s: salto de %s km desde la última echada. Revisar/sanear.', coalesce(v_placa,'Un vehículo'), v_km_recorridos),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;
    if v_sin_asignacion and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'combustible_revisar',
        'Echada sin asignación',
        format('%s: echada registrada por %s sin ser el asignado del vehículo. Revisar.',
          coalesce(v_placa,'Un vehículo'),
          coalesce((select nombre from sgc.usuarios where id = v_uid), 'un usuario')),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;

    if v_diferencia_marcada and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'combustible_diferencia',
        'Diferencia entre lo tecleado y el recibo',
        format('%s: el chofer mantuvo un valor distinto al leído del recibo. Revisar.', coalesce(v_placa,'Un vehículo')),
        '/flota/combustible-log?echada=' || v_id::text, v_id, 'echada');
    end if;
  end if;

  if v_tarjeta_norm is not null and not v_es_prueba then
    select * into v_consumo from sgc.tarjeta_consumo_periodo(v_tarjeta_norm, coalesce(p_fecha, current_date));
    if v_consumo.cupo_gal is not null or v_consumo.cupo_monto is not null then
      if coalesce(v_consumo.pct_gal, 0) >= 100 or coalesce(v_consumo.pct_monto, 0) >= 100 then
        insert into sgc.combustible_tarjeta_alertas (codigo_tarjeta, periodo, umbral)
        values (v_tarjeta_norm, v_consumo.periodo, 100) on conflict do nothing
        returning id into v_alerta_id;
      elsif coalesce(v_consumo.pct_gal, 0) >= 80 or coalesce(v_consumo.pct_monto, 0) >= 80 then
        insert into sgc.combustible_tarjeta_alertas (codigo_tarjeta, periodo, umbral)
        values (v_tarjeta_norm, v_consumo.periodo, 80) on conflict do nothing
        returning id into v_alerta_id;
      end if;
      if v_alerta_id is not null then
        perform sgc.notificar_modulo('flota', 'tarjeta_cupo_alerta',
          'Tarjeta cerca de su cupo',
          format('La tarjeta ···%s llegó al %s%% de su cupo del período.',
            right(v_tarjeta_norm, 4), round(greatest(coalesce(v_consumo.pct_gal,0), coalesce(v_consumo.pct_monto,0)))),
          '/flota/combustible/cupos-tarjetas', null, 'tarjeta');
        if v_uid is not null then
          perform sgc.notificar(v_uid, 'tarjeta_cupo_alerta', 'Tu tarjeta está cerca del cupo',
            format('La tarjeta ···%s va por el %s%% del cupo de este período.',
              right(v_tarjeta_norm, 4), round(greatest(coalesce(v_consumo.pct_gal,0), coalesce(v_consumo.pct_monto,0)))),
            '/flota/combustible');
        end if;
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
    'sin_asignacion', v_sin_asignacion,
    'aviso', case when v_sin_asignacion or v_km_alerta or v_diferencia_marcada
                  then 'Registrado. Logística (Raykler) lo revisará.' else null end,
    'promedio_rendimiento', case when v_n_prev >= v_min_reg then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona,
    'origen', v_origen,
    'numero_recibo', v_numero_recibo,
    'captura', v_captura,
    'sin_foto_bomba', v_sin_foto_bomba
  );
end;
$function$;

grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean, text, text, uuid, boolean, text, text, boolean, text, text, jsonb
) to authenticated, service_role;

-- ── 2) Fix DI4: columnas ambiguas en tarjeta_consumo_periodo (OUT params vs
--      columnas de tabla con el mismo nombre — mismo gotcha, sin alias) ────────
create or replace function sgc.tarjeta_consumo_periodo(p_codigo_tarjeta text, p_fecha date default current_date)
returns table(periodo text, galones numeric, monto numeric, cupo_gal numeric, cupo_monto numeric, pct_gal numeric, pct_monto numeric)
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_cupo_gal   numeric;
  v_cupo_monto numeric;
  v_dia_corte  smallint;
  v_desde      date;
  v_hasta      date;
  v_etiqueta   text;
  v_gal        numeric;
  v_monto      numeric;
begin
  select m.cupo_gal, m.cupo_monto, m.cupo_dia_corte into v_cupo_gal, v_cupo_monto, v_dia_corte
    from sgc.combustible_tarjeta_map m where m.codigo_tarjeta = p_codigo_tarjeta;

  select r.desde, r.hasta, r.etiqueta into v_desde, v_hasta, v_etiqueta
    from sgc.tarjeta_periodo_rango(v_dia_corte, p_fecha) r;

  select coalesce(sum(rc.galones), 0), coalesce(sum(rc.monto), 0) into v_gal, v_monto
    from sgc.registros_combustible rc
   where rc.tarjeta = p_codigo_tarjeta
     and rc.fecha between v_desde and v_hasta
     and not coalesce(rc.invalidada, false);

  periodo := v_etiqueta; galones := v_gal; monto := v_monto;
  cupo_gal := v_cupo_gal; cupo_monto := v_cupo_monto;
  pct_gal := case when v_cupo_gal is not null and v_cupo_gal > 0 then round(v_gal / v_cupo_gal * 100, 1) else null end;
  pct_monto := case when v_cupo_monto is not null and v_cupo_monto > 0 then round(v_monto / v_cupo_monto * 100, 1) else null end;
  return next;
end;
$function$;
grant execute on function sgc.tarjeta_consumo_periodo(text, date) to authenticated, service_role;

-- ── 3) Fix DI4: tarjeta_periodo_rango con smallint rechazaba un entero literal
--      sin cast explícito (sin cast implícito int4→int2). Se cambia a integer. ──
drop function if exists sgc.tarjeta_periodo_rango(smallint, date);

create or replace function sgc.tarjeta_periodo_rango(p_dia_corte integer, p_fecha date default current_date)
returns table(desde date, hasta date, etiqueta text)
language plpgsql stable
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_fin_mes date;
  v_dia     int;
  v_corte   date;
begin
  if p_dia_corte is null or p_dia_corte < 1 or p_dia_corte > 31 then
    desde := date_trunc('month', p_fecha)::date;
    hasta := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
    etiqueta := to_char(p_fecha, 'YYYY-MM');
    return next;
    return;
  end if;
  v_fin_mes := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
  v_dia := least(p_dia_corte, extract(day from v_fin_mes)::int);
  v_corte := make_date(extract(year from p_fecha)::int, extract(month from p_fecha)::int, v_dia);
  if p_fecha >= v_corte then
    desde := v_corte;
    hasta := (v_corte + interval '1 month - 1 day')::date;
  else
    desde := (v_corte - interval '1 month')::date;
    hasta := (v_corte - interval '1 day')::date;
  end if;
  etiqueta := to_char(desde, 'YYYY-MM-DD') || '..' || to_char(hasta, 'YYYY-MM-DD');
  return next;
end;
$function$;
grant execute on function sgc.tarjeta_periodo_rango(integer, date) to authenticated, service_role;

-- Verificación:
--   select pronargs, count(*) from pg_proc where proname='registrar_combustible_app'
--     and pronamespace='sgc'::regnamespace group by pronargs;
--   -- 1 sola fila: pronargs=26, count=1.
--   select * from sgc.tarjeta_periodo_rango(15, '2026-11-03'::date);
--   select * from sgc.tarjeta_consumo_periodo('203453');
--   -- ambas deben devolver 1 fila sin error.
