-- ============================================================================
-- CO15 + CO3/CO5/CO16 — PROMPT-98 FASE 1 (14/10/2026)
-- Regla 19: recreada sobre la definición VIVA de prod (dump pg_get_functiondef).
--
-- CO15: registrar_combustible_app nunca guardaba p_numero_recibo (la app lo manda,
-- ninguna versión en sql/ lo tenía → siempre caía al reintento sin él, CC6/CD8).
-- Gana p_numero_recibo (normalizado a dígitos); si choca con el único parcial por
-- vehículo (uq_combustible_vehiculo_recibo, CD8) devuelve la fila existente con
-- `duplicado:true` en vez de fallar.
--
-- CO3/CO5/CO16 — doble toque: la causa real (confirmada con las filas de prod en
-- F0) es que el cliente manda 2-5 submits casi simultáneos ANTES de que la bandera
-- `submitting` se ponga en true (arreglo de raíz = del lado del cliente, F1.3). Esta
-- migración es la RED DE SEGURIDAD del servidor: ningún cliente — viejo, nuevo, web
-- o app — puede crear 2 filas iguales en una ventana de 120s, sin tocar la firma de
-- client_uuid que ya protegía el caso de reintento limpio.
--
-- Aditivo e idempotente (create or replace). Afecta:
--   - sgc.registrar_combustible_app  (+p_numero_recibo, 22-arg; +anti-dup 120s)
--   - sgc.registrar_salida_inventario (+anti-dup 120s por contenido, sin cambiar firma)
--   - sgc.crear_conduce_externo       (+anti-dup 120s por contenido, sin cambiar firma)
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── 1) registrar_combustible_app — +p_numero_recibo +anti-dup 120s ──────────
create or replace function sgc.registrar_combustible_app(p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date, p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text DEFAULT NULL::text, p_foto_recibo_path text DEFAULT NULL::text, p_foto_tablero_path text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_foto_bomba_path text DEFAULT NULL::text, p_producto text DEFAULT NULL::text, p_tarjeta text DEFAULT NULL::text, p_titular text DEFAULT NULL::text, p_titular_es_persona boolean DEFAULT false, p_subtipo text DEFAULT NULL::text, p_origen text DEFAULT 'estacion'::text, p_proyecto_id uuid DEFAULT NULL::uuid, p_confirmado boolean DEFAULT false, p_foto_origen text DEFAULT 'camara'::text, p_numero_recibo text DEFAULT NULL::text)
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
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- BV1 — la fecha de la echada no puede ser futura, y una fecha PASADA (retroactiva)
  -- solo se permite con un permiso vigente (o si el usuario es flota-elevado/admin).
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

  -- CO15 — un recibo ya guardado para este vehículo (no invalidado) = la misma
  -- echada; en vez de fallar el unique parcial, devuelve la existente.
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

  -- CO3/CO16 — anti-duplicado de 120s (red de seguridad del servidor; el arreglo
  -- de raíz es del cliente). Mismo vehículo/persona + galones + monto + quien
  -- registra, en menos de 2 minutos = el mismo toque repetido.
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

  -- BQ7 — Blindaje del conductor_id (corolario regla 13/14).
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

  -- AW3 — TOPE DURO de galones (integridad).  BR1: un flota-elevado con p_confirmado
  -- lo pasa (regla 15: el rechazo duro es lo físicamente imposible, y el elevado
  -- puede confirmar que sí fue así).
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

  -- AW3 — banda de precio por galón.  BR1: elevado+confirmado la pasa.
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

  if not v_persona then
    if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
      raise exception 'Vehículo no encontrado o inactivo';
    end if;

    -- AF18 — solo el usuario asignado registra en su vehículo (BO4: bypass a flota
    -- elevado; BQ7b: une uso-v2).  BR1 (regla 15): si aun así no coincide, ya NO
    -- rechaza — se acepta con bandera sin_asignacion y se avisa a logística.
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
        v_sin_asignacion := true;   -- BR1: antes era raise ... using errcode='DR481'
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
      perform sgc.error_campo('kilometraje', 'menor_que_actual',
        format('La lectura (%s %s) no puede ser menor a la lectura actual del vehículo (%s %s).',
          p_kilometraje, v_uni, v_odometro, v_uni));
    end if;

    -- La echada anterior (excluye invalidadas para no arrastrar km corruptos).
    select max(kilometraje) into v_km_anterior
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and kilometraje is not null
       and coalesce(es_prueba, false) = v_es_prueba
       and not coalesce(invalidada, false);

    -- BR1 — km base editable por admin: reinicia el punto de medición del salto sin
    -- tocar las echadas históricas.  Solo en el contexto real (no es_prueba).
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

      -- AF19 — salto de km entre echadas.  BR1 (regla 15): ya NO rechaza a nadie —
      -- se acepta con bandera km_alerta y se avisa a logística (Raykler sanea).
      if v_medida <> 'horas' then
        v_umbral_km := coalesce((select valor from sgc.flota_config where clave='umbral_km_echada'), 1000);
        if v_km_recorridos > v_umbral_km then
          v_km_alerta := true;
        end if;
      end if;
    end if;

    -- CE12 — rango por vehículo (vehículo → clase → global) en vez de solo global.
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

  -- AW3 — confirmación de valores inusuales (soft).
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
    numero_recibo
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
    v_origen, p_proyecto_id, v_uid, v_km_alerta, v_sin_asignacion, v_foto_origen,
    v_numero_recibo
  );

  if not v_persona then
    perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

    -- AW2 — aviso de consumo anormal (con dirección).
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

    -- BR1 — banderas de revisión (regla 15): se avisa a logística sin bloquear.
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
    'aviso', case when v_sin_asignacion or v_km_alerta
                  then 'Registrado. Logística (Raykler) lo revisará.' else null end,
    'promedio_rendimiento', case when v_n_prev >= v_min_reg then round(v_prom, 2) else null end,
    'rendimiento_esperado', v_esperado,
    'promedio_flota', case when v_prom_flota is not null then round(v_prom_flota, 2) else null end,
    'referencia_alerta', v_ref_tipo,
    'odometro', v_odometro,
    'medida_uso', v_medida,
    'titular_es_persona', v_persona,
    'origen', v_origen,
    'numero_recibo', v_numero_recibo
  );
end;
$function$;

grant execute on function sgc.registrar_combustible_app(uuid,uuid,uuid,date,integer,numeric,numeric,text,text,text,text,text,text,text,text,boolean,text,text,uuid,boolean,text,text) to authenticated;

-- ── 2) registrar_salida_inventario — +anti-dup 120s por contenido ───────────
-- Firma SIN cambios (no hay client_uuid en salidas_inventario); se detecta el
-- reintento por contenido: mismo creado_por + bodega + proyecto + motivo + el
-- mismo conjunto de renglones (articulo_id:cantidad), en menos de 2 minutos.
create or replace function sgc.registrar_salida_inventario(p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid, p_es_prueba boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_salida_id     uuid;
  v_item          jsonb;
  v_stock_actual  numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
  v_responsable   text := p_responsable;   -- BR2
  v_items_key     text;                     -- CO16
  v_existente     uuid;                     -- CO16
begin
  if p_responsable_id is not null then
    select coalesce(nombre, p_responsable) into v_responsable from sgc.usuarios where id = p_responsable_id;
    v_responsable := coalesce(v_responsable, p_responsable);
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  -- CO16 — anti-duplicado de 120s: mismo creado_por+bodega+proyecto+motivo y el
  -- mismo conjunto de renglones (articulo_id:cantidad) = el mismo toque repetido.
  -- cantidad se normaliza a numeric(10,2) en AMBOS lados (la columna lo es; el
  -- valor que sale de jsonb no trae la escala fija y "1" != "1.00" rompía el match).
  select string_agg(format('%s:%s', i->>'articulo_id', (i->>'cantidad')::numeric(10,2)), ',' order by i->>'articulo_id')
    into v_items_key
    from jsonb_array_elements(p_items) i;

  select si.id into v_existente
    from sgc.salidas_inventario si
   where si.creado_por = p_creado_por
     and si.bodega_id = p_bodega_id
     and coalesce(si.proyecto_id::text,'') = coalesce(p_proyecto_id::text,'')
     and coalesce(si.motivo,'') = coalesce(p_motivo,'')
     and si.created_at > now() - interval '120 seconds'
     and v_items_key is not null
     and v_items_key = (
       select string_agg(format('%s:%s', d.articulo_id, d.cantidad::numeric(10,2)), ',' order by d.articulo_id)
         from sgc.detalle_salidas d where d.salida_id = si.id
     )
   order by si.created_at asc
   limit 1;
  if v_existente is not null then
    return v_existente;
  end if;

  -- CL6 — un movimiento de PRUEBA no valida existencia ni mueve stock real.
  if not coalesce(p_es_prueba, false) then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
      select a.nombre, coalesce(s.cantidad, 0)
        into v_nombre, v_stock_actual
      from sgc.articulos a
      left join sgc.stock_por_bodega s
        on s.articulo_id = a.id and s.bodega_id = p_bodega_id
      where a.id = (v_item->>'articulo_id')::uuid;

      v_nombre := coalesce(v_nombre, 'artículo desconocido');
      v_stock_actual := coalesce(v_stock_actual, 0);

      if v_stock_actual < v_solicitado then
        v_faltantes := v_faltantes || format(
          'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
          v_nombre, v_bodega_nombre,
          trim(to_char(v_stock_actual, 'FM999999990.###')),
          trim(to_char(v_solicitado,  'FM999999990.###'))
        );
      end if;
    end loop;

    if array_length(v_faltantes, 1) > 0 then
      raise exception '%', array_to_string(v_faltantes, E'\n');
    end if;
  end if;

  -- es_prueba se fija en la CABECERA antes de insertar el detalle: así el trigger de
  -- stock (trg_detalle_salidas_stock) ve es_prueba=true y NO ajusta existencias.
  -- es_prueba_origen es NOT NULL DEFAULT 'manual' → se deja que lo ponga el default.
  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, responsable_id, observaciones, creado_por, es_prueba)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, v_responsable, p_responsable_id, p_observaciones, p_creado_por,
          coalesce(p_es_prueba, false))
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla, unidad_capturada, factor_aplicado, origen_item_id)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', ''),
         nullif(i->>'unidad_capturada', ''), coalesce(nullif(i->>'factor_aplicado', '')::numeric, 1),
         nullif(i->>'origen_item_id', '')::uuid
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

grant execute on function sgc.registrar_salida_inventario(date,uuid,uuid,text,character varying,text,uuid,jsonb,uuid,boolean) to authenticated;

-- ── 3) crear_conduce_externo — +anti-dup 120s por contenido ─────────────────
create or replace function sgc.crear_conduce_externo(p_transporta_proveedor_id uuid, p_transporta_texto text, p_placa_foto_path text, p_carga_foto_path text DEFAULT NULL::text, p_material_descripcion text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb, p_origen text DEFAULT NULL::text, p_origen_lat numeric DEFAULT NULL::numeric, p_origen_lng numeric DEFAULT NULL::numeric, p_origen_proyecto_id uuid DEFAULT NULL::uuid, p_origen_bodega_id uuid DEFAULT NULL::uuid, p_destino text DEFAULT NULL::text, p_destino_lat numeric DEFAULT NULL::numeric, p_destino_lng numeric DEFAULT NULL::numeric, p_destino_proyecto_id uuid DEFAULT NULL::uuid, p_destino_bodega_id uuid DEFAULT NULL::uuid, p_emisor_firma_path text DEFAULT NULL::text, p_origen_requisicion_id uuid DEFAULT NULL::uuid, p_salida_id uuid DEFAULT NULL::uuid, p_es_prueba boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_id uuid;
  v_prueba boolean;
  v_salida_id uuid;
  v_entrada_id uuid;
  v_afecta boolean := false;
  v_resp text;
  v_sal sgc.salidas_inventario%rowtype;
  v_existente uuid;   -- CO16
begin
  if not sgc.puede_crear_conduce() then
    raise exception 'No puedes crear conduces (no eres transportista ni tienes el módulo Inventario).';
  end if;
  if nullif(btrim(coalesce(p_placa_foto_path,'')),'') is null then
    raise exception 'La foto de la placa del camión es obligatoria.';
  end if;
  if p_transporta_proveedor_id is null and nullif(btrim(coalesce(p_transporta_texto,'')),'') is null then
    raise exception 'Indica quién transporta (proveedor o texto «Otro»).';
  end if;

  -- CO16 — anti-duplicado de 120s: mismo autor + mismo origen/destino + misma foto
  -- de placa (estable entre reintentos de un mismo submit) + sin enlazar a una
  -- salida ya emitida (ese caso ya es idempotente por p_salida_id).
  if p_salida_id is null then
    select ce.id into v_existente
      from sgc.conduces_externos ce
     where ce.creado_por = auth.uid()
       and coalesce(ce.origen,'') = coalesce(nullif(btrim(p_origen),''),'')
       and coalesce(ce.destino,'') = coalesce(nullif(btrim(p_destino),''),'')
       and ce.placa_foto_path = p_placa_foto_path
       and ce.created_at > now() - interval '120 seconds'
     order by ce.created_at asc
     limit 1;
    if v_existente is not null then
      return v_existente;
    end if;
  end if;

  -- CL6 — solo un admin puede marcar un conduce nuevo como prueba; no se ignora en silencio.
  if coalesce(p_es_prueba, false) and not sgc.is_admin() then
    raise exception 'Solo un administrador puede marcar datos de prueba.';
  end if;
  -- Hereda del usuario de prueba (comportamiento previo) o lo fuerza el admin.
  v_prueba := sgc.usuario_actual_es_prueba() or coalesce(p_es_prueba, false);

  if p_transporta_proveedor_id is not null
     and not exists (
       select 1 from sgc.proveedores p
       where p.id = p_transporta_proveedor_id
         and 'transportista' = any(coalesce(p.tipos, array[]::text[]))
         and coalesce(p.activo, true)
     ) then
    perform sgc.error_campo(
      'transporta_proveedor_id', 'no_existe',
      'Ese proveedor de transporte ya no está disponible. Elige otro o escribe quién transporta.');
  end if;

  select nombre into v_resp from sgc.usuarios where id = auth.uid();

  -- CJ6 — si viene una salida existente (despacho ya emitido), se ENLAZA (no se crea otra).
  if p_salida_id is not null then
    select * into v_sal from sgc.salidas_inventario where id = p_salida_id for update;
    if not found then raise exception 'La salida indicada no existe.'; end if;
    if v_sal.estado not in ('despachado') then
      raise exception 'Esa salida ya no está en estado despachado; no se puede enlazar.';
    end if;
    if p_origen_bodega_id is not null and v_sal.bodega_id <> p_origen_bodega_id then
      raise exception 'La salida no es del almacén de origen indicado.';
    end if;
    v_salida_id := p_salida_id;
    v_afecta := true;
  -- Impacto de inventario (solo si hay items del catálogo y toca un almacén nuestro).
  elsif p_items is not null and jsonb_array_length(p_items) > 0 then
    if p_origen_bodega_id is not null then
      v_salida_id := sgc.registrar_salida_inventario(
        current_date, p_origen_bodega_id, p_destino_proyecto_id, 'conduce_externo',
        coalesce(v_resp,'')::varchar, coalesce(p_material_descripcion,''), auth.uid(), p_items,
        p_es_prueba => v_prueba);
      v_afecta := true;
    elsif p_destino_bodega_id is not null then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, pendiente_confirmacion, items_propuestos, es_prueba)
      values (
        current_date, p_destino_bodega_id, null, null, 'Conduce externo',
        coalesce(p_material_descripcion,''), auth.uid(), 'otro', p_origen_proyecto_id, true, p_items, v_prueba)
      returning id into v_entrada_id;
      v_afecta := true;
    end if;
  end if;

  insert into sgc.conduces_externos (
    transporta_proveedor_id, transporta_texto, placa_foto_path, carga_foto_path,
    material_descripcion, afecta_inventario, salida_id, entrada_id,
    origen, origen_lat, origen_lng, origen_proyecto_id, origen_bodega_id,
    destino, destino_lat, destino_lng, destino_proyecto_id, destino_bodega_id,
    emisor_firma_path, origen_requisicion_id, es_prueba, es_prueba_origen)
  values (
    p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), p_placa_foto_path, p_carga_foto_path,
    nullif(btrim(p_material_descripcion),''), v_afecta, v_salida_id, v_entrada_id,
    nullif(btrim(p_origen),''), p_origen_lat, p_origen_lng, p_origen_proyecto_id, p_origen_bodega_id,
    nullif(btrim(p_destino),''), p_destino_lat, p_destino_lng, p_destino_proyecto_id, p_destino_bodega_id,
    p_emisor_firma_path, p_origen_requisicion_id, v_prueba,
    case when v_prueba then (case when coalesce(p_es_prueba,false) then 'manual' else 'heredado' end) else null end)
  returning id into v_id;

  -- Si enlazamos una salida existente, cuélgale la requisición de origen si falta.
  if p_salida_id is not null and p_origen_requisicion_id is not null then
    update sgc.salidas_inventario set origen_requisicion_id = p_origen_requisicion_id
      where id = p_salida_id and origen_requisicion_id is null;
  end if;

  insert into sgc.viajes_transporte (proveedor_id, proveedor_texto, conduce_externo_id, fecha, es_prueba)
  values (p_transporta_proveedor_id, nullif(btrim(p_transporta_texto),''), v_id, current_date, v_prueba);

  if nullif(btrim(p_origen),'') is not null and p_origen_lat is null
     and p_origen_proyecto_id is null and p_origen_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_origen, 'conduce_externo', v_id, 'origen');
  end if;
  if nullif(btrim(p_destino),'') is not null and p_destino_lat is null
     and p_destino_proyecto_id is null and p_destino_bodega_id is null then
    perform sgc.registrar_lugar_pendiente(p_destino, 'conduce_externo', v_id, 'destino');
  end if;

  return v_id;
end;
$function$;

grant execute on function sgc.crear_conduce_externo(uuid,text,text,text,text,jsonb,text,numeric,numeric,uuid,uuid,text,numeric,numeric,uuid,uuid,text,uuid,uuid,boolean) to authenticated;

commit;
