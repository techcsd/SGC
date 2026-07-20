-- ============================================================================
-- P7 — El kilometraje registrado avanza el odómetro real del vehículo (20/07/2026)
-- ----------------------------------------------------------------------------
-- Migración ADITIVA y RETROCOMPATIBLE (create or replace, sin cambiar firmas).
--
-- HOY solo `registrar_combustible_app` avanzaba `sgc.vehiculos.kilometraje`
-- (regla "solo avanza"). `crear_entrega_vehiculo` ya lo hacía vía greatest();
-- pero el pre-uso (`registrar_checklist_vehiculo`), el mantenimiento
-- (`completar_mantenimiento`, `crear_mantenimiento_app`) NO tocaban el odómetro.
--
-- Se introduce el helper común `sgc.avanzar_odometro(vehiculo_id, km)` con la
-- regla de NO-RETROCESO y se invoca desde TODOS los RPCs que reciben km. Los km
-- siguen guardándose además en su tabla propia (histórico intacto).
-- ============================================================================

set search_path = sgc, public;

-- ── 1) Helper común: avanza el odómetro solo si el km nuevo es mayor ─────────
-- No baja nunca el kilometraje. Redondea hacia abajo (la columna es int).
-- Se ejecuta dentro de RPCs SECURITY DEFINER, así que hereda sus privilegios;
-- no necesita ser definer por sí mismo.
create or replace function sgc.avanzar_odometro(p_vehiculo_id uuid, p_km numeric)
returns void
language plpgsql
set search_path to 'sgc','pg_temp'
as $$
begin
  if p_vehiculo_id is null or p_km is null then return; end if;
  update sgc.vehiculos
     set kilometraje = floor(p_km)::int
   where id = p_vehiculo_id
     and floor(p_km)::int > coalesce(kilometraje, 0);
end;
$$;
grant execute on function sgc.avanzar_odometro(uuid, numeric) to authenticated, service_role;

-- ── 2) registrar_checklist_vehiculo (pre-uso) — ahora avanza el odómetro ─────
-- Idéntica a la versión de flota-v2, con `perform sgc.avanzar_odometro(...)`
-- tras persistir el checklist.
create or replace function sgc.registrar_checklist_vehiculo(
  p_id              uuid,
  p_plantilla_id    uuid,
  p_vehiculo_id     uuid,
  p_conductor_id    uuid,
  p_tipo            text,
  p_fecha           date,
  p_datos           jsonb,
  p_kilometraje     numeric,
  p_respuestas      jsonb,
  p_fotos           jsonb,
  p_firma_path      text,
  p_observaciones   text,
  p_capturado_en    timestamptz,
  p_nivel_combustible text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid       uuid := auth.uid();
  v_criticos  boolean := false;
  v_hay_no    boolean := false;
  v_resultado text;
  v_km        int;
  v_km_ult    int;
  v_intervalo int;
  v_proximo   int;
  v_faltan    int;
  v_alerta_mant text := 'ok';
  v_umbral_pre numeric;
  v_lic_venc  date;
  v_mat_venc  date;
  v_seg_venc  date;
  v_placa     text;
  v_cond_nom  text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia: reenvío del mismo op devuelve el id existente.
  if exists (select 1 from sgc.checklists_vehiculo where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- ── Bloqueos duros (además del cliente) ──────────────────────────────────
  select placa, vencimiento_matricula, vencimiento_seguro, km_ultimo_mantenimiento, intervalo_mantenimiento_km
    into v_placa, v_mat_venc, v_seg_venc, v_km_ult, v_intervalo
    from sgc.vehiculos where id = p_vehiculo_id;

  if v_mat_venc is not null and v_mat_venc < current_date then
    raise exception 'La matrícula del vehículo (%) está vencida (venció %). No puede salir.', v_placa, v_mat_venc;
  end if;
  if v_seg_venc is not null and v_seg_venc < current_date then
    raise exception 'El seguro del vehículo (%) está vencido (venció %). No puede salir.', v_placa, v_seg_venc;
  end if;

  if p_conductor_id is not null then
    select licencia_vencimiento, nombre into v_lic_venc, v_cond_nom
      from sgc.conductores where id = p_conductor_id;
    if v_lic_venc is not null and v_lic_venc < current_date then
      raise exception 'La licencia del conductor % está vencida (venció %). Contacta a RRHH.', coalesce(v_cond_nom,''), v_lic_venc;
    end if;
  end if;

  -- ── Veredicto tri-estado ─────────────────────────────────────────────────
  select
      coalesce(bool_or((r->>'es_critico')::boolean and lower(r->>'respuesta') = 'no'), false),
      coalesce(bool_or(lower(r->>'respuesta') = 'no'), false)
    into v_criticos, v_hay_no
    from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  v_resultado := case when v_criticos then 'bloqueado'
                      when v_hay_no  then 'con_hallazgos'
                      else 'aprobado' end;

  -- ── Alerta de mantenimiento por km ───────────────────────────────────────
  v_km := floor(coalesce(p_kilometraje, 0))::int;
  if v_km_ult is not null and v_km > 0 then
    v_proximo := v_km_ult + coalesce(v_intervalo, 5000);
    v_faltan  := v_proximo - v_km;
    select valor into v_umbral_pre from sgc.flota_config where clave = 'umbral_precita_km';
    v_umbral_pre := coalesce(v_umbral_pre, 500);
    v_alerta_mant := case when v_faltan <= 0 then 'vencido'
                          when v_faltan <= v_umbral_pre then 'pre_cita'
                          else 'ok' end;
  else
    v_faltan := null;
    v_alerta_mant := 'ok';
  end if;

  -- ── Persistir cabecera + detalle ─────────────────────────────────────────
  insert into sgc.checklists_vehiculo (
    id, plantilla_id, vehiculo_id, conductor_id, tipo, fecha, datos, kilometraje,
    firma_path, observaciones, tiene_criticos, creado_por, capturado_en,
    nivel_combustible, resultado, km_faltan_mantenimiento, alerta_mantenimiento
  ) values (
    p_id, p_plantilla_id, p_vehiculo_id, p_conductor_id, coalesce(p_tipo,'pre_uso'),
    coalesce(p_fecha, current_date), coalesce(p_datos, '{}'::jsonb), p_kilometraje,
    p_firma_path, p_observaciones, v_criticos, v_uid, coalesce(p_capturado_en, now()),
    nullif(p_nivel_combustible,''), v_resultado, v_faltan, v_alerta_mant
  );

  insert into sgc.checklist_vehiculo_respuestas (checklist_id, etiqueta, seccion, es_critico, respuesta, comentario, orden)
  select p_id, r->>'etiqueta', r->>'seccion',
         coalesce((r->>'es_critico')::boolean, false),
         coalesce(lower(r->>'respuesta'), 'na'),
         r->>'comentario',
         coalesce((r->>'orden')::int, 0)
  from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  insert into sgc.checklist_vehiculo_fotos (checklist_id, storage_path, slot)
  select p_id, f->>'storage_path', f->>'slot'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
  where nullif(f->>'storage_path','') is not null;

  -- P7 — el km del pre-uso avanza el odómetro real (regla de no-retroceso).
  perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

  -- ── Avisos + notificaciones ──────────────────────────────────────────────
  if v_resultado = 'bloqueado' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('bloqueo_critico', p_vehiculo_id, p_conductor_id, p_id,
      format('Vehículo %s BLOQUEADO en pre-uso: ítem(s) crítico(s) en NO. Fuera de servicio hasta corrección.', coalesce(v_placa,'')), 'alta');
    perform sgc.notificar_modulo('flota', 'error',
      'Vehículo bloqueado en pre-uso',
      format('%s no puede salir: falló un ítem crítico del checklist.', coalesce(v_placa,'Un vehículo')),
      '/flota/checklists');
  elsif v_resultado = 'con_hallazgos' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('hallazgos', p_vehiculo_id, p_conductor_id, p_id,
      format('Vehículo %s con hallazgos no críticos en pre-uso. Requiere corrección.', coalesce(v_placa,'')), 'media');
    perform sgc.notificar_modulo('flota', 'warning',
      'Pre-uso con hallazgos',
      format('%s salió con hallazgos no críticos. Coordinar corrección.', coalesce(v_placa,'Un vehículo')),
      '/flota/checklists');
  end if;

  if v_alerta_mant = 'vencido' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('mantenimiento_vencido', p_vehiculo_id, p_conductor_id, p_id,
      format('Mantenimiento VENCIDO en %s (%s km pasados del próximo).', coalesce(v_placa,''), abs(v_faltan)), 'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Mantenimiento vencido',
      format('%s superó su intervalo de mantenimiento.', coalesce(v_placa,'Un vehículo')),
      '/flota/mantenimientos');
  elsif v_alerta_mant = 'pre_cita' then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('pre_cita', p_vehiculo_id, p_conductor_id, p_id,
      format('Agendar PRE-CITA de mantenimiento para %s (faltan %s km).', coalesce(v_placa,''), v_faltan), 'media');
    perform sgc.notificar_modulo('flota', 'info',
      'Agendar pre-cita de mantenimiento',
      format('A %s le faltan %s km para el mantenimiento.', coalesce(v_placa,'un vehículo'), v_faltan),
      '/flota/mantenimientos');
  end if;

  return p_id;
end;
$$;
grant execute on function sgc.registrar_checklist_vehiculo(
  uuid, uuid, uuid, uuid, text, date, jsonb, numeric, jsonb, jsonb, text, text, timestamptz, text
) to authenticated, service_role;

-- ── 3) crear_entrega_vehiculo (recibir/devolver) — usa el helper ────────────
-- Ya avanzaba el odómetro vía greatest(); se refactoriza al helper común
-- (comportamiento idéntico, regla de no-retroceso).
create or replace function sgc.crear_entrega_vehiculo(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_km numeric, p_combustible text,
  p_tiene_danos boolean, p_danos jsonb, p_firma_url text, p_fotos jsonb, p_gps jsonb,
  p_capturado_en timestamptz, p_observacion text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','public'
as $$
declare
  v_uid uuid := auth.uid();
  v_recepcion sgc.vehiculo_entregas;
  v_estado text := 'abierta';
  v_recepcion_id uuid := null;
  v_requiere boolean := false;
  v_slots text[];
  v_required text[] := array['frente','atras','lado_izq','lado_der','tablero','combustible'];
  s text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('flota') then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotency: a re-sent op returns the existing id, no duplicate.
  if exists (select 1 from sgc.vehiculo_entregas where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- Required guided photos (server double-checks the client).
  select array_agg(distinct f->>'slot')
    into v_slots
    from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;
  foreach s in array v_required loop
    if v_slots is null or not (s = any(v_slots)) then
      raise exception 'Falta la foto obligatoria: %', s;
    end if;
  end loop;

  if p_tipo = 'recepcion' then
    if exists (select 1 from sgc.vehiculo_entregas
               where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta') then
      raise exception 'Este vehículo ya tiene una entrega abierta';
    end if;
    v_estado := 'abierta';
  elsif p_tipo = 'devolucion' then
    select * into v_recepcion from sgc.vehiculo_entregas
      where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta'
      order by created_at desc limit 1;
    if v_recepcion.id is null then
      raise exception 'No hay una entrega abierta de este vehículo para devolver';
    end if;
    if v_recepcion.conductor_usuario_id <> v_uid and not sgc.is_admin() then
      raise exception 'La entrega abierta es de otro conductor';
    end if;
    v_recepcion_id := v_recepcion.id;
    v_estado := 'cerrada';
    v_requiere := coalesce(p_tiene_danos, false) or p_km < v_recepcion.km;
  else
    raise exception 'Tipo inválido: %', p_tipo;
  end if;

  insert into sgc.vehiculo_entregas(
    id, vehiculo_id, conductor_usuario_id, tipo, entrega_recepcion_id, estado,
    km, combustible, tiene_danos, observacion, firma_url, gps_lat, gps_lng,
    requiere_revision, capturado_en, creado_por
  ) values (
    p_id, p_vehiculo_id, v_uid, p_tipo, v_recepcion_id, v_estado,
    p_km, p_combustible, coalesce(p_tiene_danos, false), p_observacion, p_firma_url,
    nullif(p_gps->>'lat', '')::numeric, nullif(p_gps->>'lng', '')::numeric,
    v_requiere, p_capturado_en, v_uid
  );

  insert into sgc.vehiculo_entrega_fotos(id, entrega_id, slot, storage_path)
  select coalesce(nullif(f->>'id', '')::uuid, gen_random_uuid()), p_id, f->>'slot', f->>'path'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;

  insert into sgc.vehiculo_entrega_danos(id, entrega_id, zona, descripcion, foto_path, es_nuevo)
  select coalesce(nullif(d->>'id', '')::uuid, gen_random_uuid()), p_id,
         d->>'zona', d->>'descripcion', d->>'foto_path', (p_tipo = 'devolucion')
  from jsonb_array_elements(coalesce(p_danos, '[]'::jsonb)) d;

  if p_tipo = 'devolucion' then
    update sgc.vehiculo_entregas set estado = 'cerrada' where id = v_recepcion_id;
    update sgc.vehiculos set responsable_id = null where id = p_vehiculo_id;
  else
    update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;
  end if;

  -- P7 — el km de recepción/devolución también avanza el odómetro real.
  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);

  return p_id;
end;
$$;
grant execute on function sgc.crear_entrega_vehiculo(
  uuid, uuid, text, numeric, text, boolean, jsonb, text, jsonb, jsonb, timestamptz, text
) to authenticated, service_role;

-- ── 4) completar_mantenimiento — mantiene km_ultimo y ADEMÁS avanza odómetro ─
create or replace function sgc.completar_mantenimiento(p_id uuid, p_km integer default null)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare v_veh uuid; v_km int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then raise exception 'No autorizado'; end if;

  select vehiculo_id, coalesce(p_km, kilometraje_al_mantenimiento)
    into v_veh, v_km
  from sgc.mantenimientos where id = p_id;
  if v_veh is null then raise exception 'Mantenimiento no encontrado'; end if;

  update sgc.mantenimientos
     set estado = 'completado',
         kilometraje_al_mantenimiento = coalesce(p_km, kilometraje_al_mantenimiento)
   where id = p_id;

  -- Resetear el contador del próximo mantenimiento.
  if v_km is not null then
    update sgc.vehiculos set km_ultimo_mantenimiento = v_km where id = v_veh;
    -- P7 — el km del mantenimiento también avanza el odómetro real.
    perform sgc.avanzar_odometro(v_veh, v_km);
  end if;

  -- Atender avisos de mantenimiento pendientes de ese vehículo.
  update sgc.avisos_flota
     set estado='atendido', atendido_por=auth.uid(), atendido_at=now(),
         nota_atencion='Mantenimiento completado'
   where vehiculo_id = v_veh and estado='pendiente'
     and tipo in ('mantenimiento_vencido','pre_cita');
end; $$;
grant execute on function sgc.completar_mantenimiento(uuid, integer) to authenticated, service_role;

-- ── 5) crear_mantenimiento_app — avanza el odómetro con el km capturado ──────
create or replace function sgc.crear_mantenimiento_app(
  p_id uuid, p_vehiculo_id uuid, p_tipo text, p_descripcion text, p_fecha date,
  p_km numeric, p_fotos jsonb, p_capturado_en timestamptz
) returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.mantenimientos where id = p_id) then
    return p_id;  -- idempotente
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  insert into sgc.mantenimientos (id, vehiculo_id, tipo, descripcion, fecha, kilometraje_al_mantenimiento, estado, fotos)
  values (
    p_id, p_vehiculo_id, coalesce(nullif(p_tipo,''),'correctivo'), p_descripcion,
    coalesce(p_fecha, current_date), p_km, 'pendiente',
    coalesce((select array_agg(f->>'storage_path') from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f
              where nullif(f->>'storage_path','') is not null), '{}')
  );

  -- P7 — el km registrado en el mantenimiento avanza el odómetro real.
  perform sgc.avanzar_odometro(p_vehiculo_id, p_km);

  return p_id;
end;
$$;
grant execute on function sgc.crear_mantenimiento_app(
  uuid, uuid, text, text, date, numeric, jsonb, timestamptz
) to authenticated, service_role;

-- ── 6) registrar_combustible_app — refactor al helper (comportamiento igual) ─
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
  v_alerta       boolean := false;
  v_placa        text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia: reenvío del mismo op devuelve el registro existente.
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

  -- Última echada del MISMO vehículo (por kilometraje). El odómetro no retrocede.
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

  -- Consumo anormal: promedio de rendimientos históricos del vehículo (>= 3).
  if v_rendimiento is not null then
    select count(*), avg(rendimiento_km_gal)
      into v_n_prev, v_prom
      from sgc.registros_combustible
     where vehiculo_id = p_vehiculo_id and rendimiento_km_gal is not null;
    if v_n_prev >= 3 and v_prom is not null then
      select valor into v_umbral from sgc.flota_config where clave = 'umbral_consumo_pct';
      v_umbral := coalesce(v_umbral, 20);
      if v_rendimiento < (1 - v_umbral / 100.0) * v_prom then
        v_alerta := true;
      end if;
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

  -- El odómetro del vehículo avanza (regla de no-retroceso, helper común).
  perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

  if v_alerta then
    select placa into v_placa from sgc.vehiculos where id = p_vehiculo_id;
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('consumo_anormal', p_vehiculo_id, p_conductor_id, v_id,
      format('Consumo anormal en %s: %s km/gal (%s%% bajo el promedio de %s km/gal). Posible fuga, problema mecánico o combustible desviado.',
        coalesce(v_placa,'vehículo'), v_rendimiento, round((1 - v_rendimiento / v_prom) * 100), round(v_prom,2)),
      'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Consumo anormal de combustible',
      format('%s registró %s km/gal, bajo el promedio del vehículo.', coalesce(v_placa,'Un vehículo'), v_rendimiento),
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
    'promedio_rendimiento', case when v_n_prev >= 3 then round(v_prom, 2) else null end
  );
end;
$$;
grant execute on function sgc.registrar_combustible_app(
  uuid, uuid, uuid, date, int, numeric, numeric, text, text, text, text
) to authenticated, service_role;
