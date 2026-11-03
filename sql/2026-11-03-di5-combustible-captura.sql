-- sql/2026-11-03-di5-combustible-captura.sql — Ronda DI (PROMPT-134 F5, DI5/DI6)
-- Modo rápido con IA (tablero + recibo, bomba opcional) y corrección de
-- diferencias en el modo normal (lo tecleado vs lo leído del recibo).
-- Aditivo. node scripts/apply-migration.mjs sql/2026-11-03-di5-combustible-captura.sql --env dev

-- ── 1) Columnas nuevas en registros_combustible ───────────────────────────────
alter table sgc.registros_combustible
  add column if not exists captura text not null default 'normal'
    check (captura in ('normal', 'rapido_ia')),
  add column if not exists sin_foto_bomba boolean not null default false,
  add column if not exists diferencias_recibo jsonb;

comment on column sgc.registros_combustible.captura is
  'DI5 — normal (flujo actual) o rapido_ia (tablero+recibo, bomba opcional, IA llena todo).';
comment on column sgc.registros_combustible.sin_foto_bomba is
  'DI12 — true cuando la echada es rapido_ia y no se tomó foto de la bomba (bomba opcional por decisión de Xaviel). Solo anotación, no abre revisión.';
comment on column sgc.registros_combustible.diferencias_recibo is
  'DI6/DI16 — [{"campo":"monto"|"galones"|"km","valor_usuario":num,"valor_leido":num,"decision":"uso_recibo"|"mantener_mio","motivo":text}] cuando lo tecleado difería >2% de lo leído por IA y el chofer decidió mantener lo suyo con motivo.';

-- ── 2) Parámetro: ¿el modo rápido exige foto de bomba? (default: no — Xaviel) ──
insert into sgc.parametros (clave, valor, descripcion) values
  ('combustible_rapido_exige_bomba', 'false',
   'DI12 — si es "true", el registro rápido con IA exige foto de la bomba en 0 (igual que el normal). Default false: la bomba es opcional en modo rápido.')
on conflict (clave) do nothing;

-- ── 3) notif_tipo — diferencia recibo vs tecleado marcada para revisión ───────
insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden) values
  ('combustible_diferencia', 'Diferencia recibo vs. tecleado',
   'El chofer mantuvo un valor distinto al leído del recibo (>2%) y quedó marcado para revisión de Logística.',
   true, array['in_app','push'], true,
   (select coalesce(max(orden), 0) + 1 from sgc.notif_tipo))
on conflict (tipo) do nothing;

-- ── 4) registrar_combustible_app — agrega p_captura / p_diferencias ───────────
-- DROP con la firma EXACTA anterior (22 args) para que esto sea un REEMPLAZO,
-- no un overload ambiguo nuevo (gotcha recurrente — ver CH1/CG2 en HANDOFF).
drop function if exists sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, integer, numeric, numeric, text, text, text, text, text,
  text, text, text, boolean, text, text, uuid, boolean, text, text
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

  -- DI12 — modo rápido: la bomba es opcional por decisión de Xaviel, salvo que
  -- el parámetro combustible_rapido_exige_bomba esté en 'true'.
  v_sin_foto_bomba := (v_captura = 'rapido_ia' and p_foto_bomba_path is null and not v_persona and not v_deposito);
  if v_sin_foto_bomba then
    v_exige_bomba := coalesce((select valor from sgc.parametros where clave = 'combustible_rapido_exige_bomba'), 'false') = 'true';
    if v_exige_bomba and not v_elevado_conf then
      perform sgc.error_campo('foto_bomba', 'requerida',
        'Falta la foto de la bomba en 0. Actívala en Flota › Combustible si quieres hacerla opcional.');
    end if;
  end if;

  -- DI16 — diferencias entre lo tecleado y lo leído del recibo que el chofer
  -- decidió mantener (con motivo) quedan marcadas para revisión de Logística.
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

    -- CZ1 — HOTFIX: antes comparaba contra el odómetro VIVO (sin fecha), lo que
    -- rechazaba cualquier echada retroactiva con km menor al actual aunque fuera
    -- correcta para su fecha (mismo bug que CH1 resolvió para mantenimientos).
    -- validar_km_vehiculo() compara contra la lectura con fecha más cercana
    -- (antes/después); solo bloquea retroceso real o exceso retroactivo imposible.
    v_validacion_km := sgc.validar_km_vehiculo(p_vehiculo_id, p_kilometraje, coalesce(p_fecha, current_date)::timestamptz);
    if coalesce(v_validacion_km->>'nivel','ok') = 'error' then
      perform sgc.error_campo('kilometraje', 'menor_que_actual', v_validacion_km->>'mensaje');
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
    nullif(p_producto,''), nullif(p_subtipo,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false),
    v_origen, p_proyecto_id, v_uid, v_km_alerta, v_sin_asignacion, v_foto_origen,
    v_numero_recibo, v_captura, v_sin_foto_bomba, p_diferencias
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

    -- DI16 — diferencia tecleado/recibo mantenida por el chofer: avisa a Logística.
    if v_diferencia_marcada and not v_es_prueba then
      perform sgc.notificar_modulo('flota', 'combustible_diferencia',
        'Diferencia entre lo tecleado y el recibo',
        format('%s: el chofer mantuvo un valor distinto al leído del recibo. Revisar.', coalesce(v_placa,'Un vehículo')),
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
  text, text, text, boolean, text, text, uuid, boolean, text, text, text, jsonb
) to authenticated, service_role;

-- ── 5) Uso de vehículo con foto de tablero (DI7/DI-18) ────────────────────────
alter table sgc.vehiculo_usos
  add column if not exists foto_tablero_inicio_path text,
  add column if not exists foto_tablero_fin_path text;

comment on column sgc.vehiculo_usos.foto_tablero_inicio_path is
  'DI7 — foto del tablero al tomar/recibir el vehículo, usada por leer-formulario (tipo uso_vehiculo) para proponer km/horas/nivel/luces.';
comment on column sgc.vehiculo_usos.foto_tablero_fin_path is
  'DI7 — foto del tablero al soltar el vehículo.';

drop function if exists sgc.set_uso_fotos(uuid, text, text, text, text);

create or replace function sgc.set_uso_fotos(
  p_uso_id uuid, p_frente text default null, p_lateral_izq text default null,
  p_lateral_der text default null, p_trasera text default null,
  p_tablero_inicio text default null, p_tablero_fin text default null
)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_owner uuid;
begin
  select usuario_id into v_owner from sgc.vehiculo_usos where id = p_uso_id;
  if v_owner is null then raise exception 'Sesión de uso no encontrada.'; end if;
  -- Solo el dueño de la sesión (o flota/admin) adjunta las fotos.
  if not (v_owner = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.vehiculo_usos set
    foto_frente_path        = coalesce(p_frente,          foto_frente_path),
    foto_lateral_izq_path   = coalesce(p_lateral_izq,     foto_lateral_izq_path),
    foto_lateral_der_path   = coalesce(p_lateral_der,     foto_lateral_der_path),
    foto_trasera_path       = coalesce(p_trasera,         foto_trasera_path),
    foto_tablero_inicio_path = coalesce(p_tablero_inicio, foto_tablero_inicio_path),
    foto_tablero_fin_path    = coalesce(p_tablero_fin,    foto_tablero_fin_path)
  where id = p_uso_id;
end;
$function$;

grant execute on function sgc.set_uso_fotos(uuid, text, text, text, text, text, text) to authenticated, service_role;

-- Verificación:
--   select column_name from information_schema.columns where table_schema='sgc'
--     and table_name='registros_combustible' and column_name in ('captura','sin_foto_bomba','diferencias_recibo');
--   -- debe devolver 3 filas.
--   select proname, pronargs from pg_proc where proname='registrar_combustible_app' and pronamespace='sgc'::regnamespace;
--   -- debe devolver 1 sola fila con pronargs=24 (no 2 filas / overload).
