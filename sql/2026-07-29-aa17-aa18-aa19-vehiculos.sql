-- ============================================================================
-- PROMPT-9 · FASE 2 — Vehículos: horómetro, catálogos, clasificación, fotos
-- Fecha: 2026-07-29
-- Aditivo / idempotente / retrocompatible. Los vehículos existentes (medida_uso
-- = 'km' por default) se comportan EXACTAMENTE igual que antes.
--
-- AA18.3 — HORÓMETRO: columna `medida_uso` (km | horas). El "odómetro" pasa a ser
--   una lectura genérica: para equipos como el Telehandler mide HORAS DE USO. Se
--   reutiliza la columna `kilometraje` como lectura actual (el helper P7
--   `avanzar_odometro` sigue siendo el único punto de avance y es unit-agnostic).
--   El mantenimiento programado usa `intervalo_mantenimiento_horas` cuando la
--   medida es horas (mismo motor de avisos). Los mensajes de aviso/no-retroceso
--   se generalizan a la unidad correcta ("km" o "h").
-- AA19 — FOTOS: columna `foto_portada` (path elegido como portada). El orden de
--   las fotos es el orden del array `fotos text[]` (reordenar = reescribir el
--   array). Cards/perfil usan foto_portada, con fallback a fotos[0].
-- AA17 — USO obra/oficina: se REUTILIZA la columna existente `uso`
--   (obra|administrativo, Z15). La UI la reetiqueta "Oficina" y agrega
--   badge/filtro/dimensión de reporte. No se crea columna nueva (evita duplicar
--   una clasificación que ya maneja el alcance del pre-uso).
-- AA18.1/2/4 — Telehandler (tipo), colores (select) y aseguradora (default
--   "Seguros Universal") son cambios de FRONTEND: la columna `tipo/color/
--   aseguradora` sigue siendo texto libre; solo cambia cómo se captura.
-- ============================================================================

-- ── Columnas aditivas ──────────────────────────────────────────────────────
alter table sgc.vehiculos
  add column if not exists medida_uso text not null default 'km',
  add column if not exists intervalo_mantenimiento_horas int,
  add column if not exists foto_portada text;

do $$ begin
  alter table sgc.vehiculos
    add constraint vehiculos_medida_uso_chk check (medida_uso in ('km', 'horas'));
exception when duplicate_object then null; end $$;

comment on column sgc.vehiculos.medida_uso is
  'AA18.3 — unidad del odómetro: km (default) u horas (maquinaria por horómetro, ej. Telehandler).';
comment on column sgc.vehiculos.intervalo_mantenimiento_horas is
  'AA18.3 — ciclo de mantenimiento en HORAS (se usa cuando medida_uso = horas).';
comment on column sgc.vehiculos.foto_portada is
  'AA19 — path de la foto usada como portada en cards/perfil (fallback: fotos[0]).';

-- Umbral de pre-cita en HORAS (equivalente a umbral_precita_km pero para horómetro).
insert into sgc.flota_config (clave, valor)
values ('umbral_precita_horas', 25)
on conflict (clave) do nothing;

-- ── AA18.3 — registrar_checklist_vehiculo (pre-uso): mantenimiento unit-aware ──
create or replace function sgc.registrar_checklist_vehiculo(
  p_id uuid, p_plantilla_id uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_tipo text,
  p_fecha date, p_datos jsonb, p_kilometraje numeric, p_respuestas jsonb, p_fotos jsonb,
  p_firma_path text, p_observaciones text, p_capturado_en timestamp with time zone,
  p_nivel_combustible text default null::text)
returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
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
  v_es_prueba boolean := false;   -- W7 — suprimir avisos de vehículos test
  v_medida    text := 'km';       -- AA18.3
  v_uni       text := 'km';       -- AA18.3 — etiqueta de unidad en los mensajes
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  if exists (select 1 from sgc.checklists_vehiculo where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  select placa, vencimiento_matricula, vencimiento_seguro, km_ultimo_mantenimiento,
         case when coalesce(medida_uso,'km') = 'horas'
              then coalesce(intervalo_mantenimiento_horas, 250)
              else coalesce(intervalo_mantenimiento_km, 5000) end,
         coalesce(es_prueba, false), coalesce(medida_uso, 'km')
    into v_placa, v_mat_venc, v_seg_venc, v_km_ult, v_intervalo, v_es_prueba, v_medida
    from sgc.vehiculos where id = p_vehiculo_id;
  v_uni := case when v_medida = 'horas' then 'h' else 'km' end;

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

  select
      coalesce(bool_or((r->>'es_critico')::boolean and lower(r->>'respuesta') = 'no'), false),
      coalesce(bool_or(lower(r->>'respuesta') = 'no'), false)
    into v_criticos, v_hay_no
    from jsonb_array_elements(coalesce(p_respuestas, '[]'::jsonb)) r;

  v_resultado := case when v_criticos then 'bloqueado'
                      when v_hay_no  then 'con_hallazgos'
                      else 'aprobado' end;

  v_km := floor(coalesce(p_kilometraje, 0))::int;
  if v_km_ult is not null and v_km > 0 then
    v_proximo := v_km_ult + coalesce(v_intervalo, 5000);
    v_faltan  := v_proximo - v_km;
    -- AA18.3 — umbral de pre-cita por unidad (km u horas).
    select valor into v_umbral_pre from sgc.flota_config
      where clave = case when v_medida = 'horas' then 'umbral_precita_horas' else 'umbral_precita_km' end;
    v_umbral_pre := coalesce(v_umbral_pre, case when v_medida = 'horas' then 25 else 500 end);
    v_alerta_mant := case when v_faltan <= 0 then 'vencido'
                          when v_faltan <= v_umbral_pre then 'pre_cita'
                          else 'ok' end;
  else
    v_faltan := null;
    v_alerta_mant := 'ok';
  end if;

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

  perform sgc.avanzar_odometro(p_vehiculo_id, p_kilometraje);

  -- Avisos + notificaciones — SUPRIMIDOS para vehículos de prueba (W7).
  if not v_es_prueba then
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
        format('Mantenimiento VENCIDO en %s: pasado con %s %s.', coalesce(v_placa,''), abs(v_faltan), v_uni), 'alta');
      perform sgc.notificar_modulo('flota', 'warning',
        'Mantenimiento vencido',
        format('%s superó su intervalo de mantenimiento.', coalesce(v_placa,'Un vehículo')),
        '/flota/mantenimientos');
    elsif v_alerta_mant = 'pre_cita' then
      insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
      values ('pre_cita', p_vehiculo_id, p_conductor_id, p_id,
        format('Agendar PRE-CITA de mantenimiento para %s (faltan %s %s).', coalesce(v_placa,''), v_faltan, v_uni), 'media');
      perform sgc.notificar_modulo('flota', 'info',
        'Agendar pre-cita de mantenimiento',
        format('A %s le faltan %s %s para el mantenimiento.', coalesce(v_placa,'un vehículo'), v_faltan, v_uni),
        '/flota/mantenimientos');
    end if;
  end if;

  return p_id;
end;
$function$;

-- ── AA18.3 — registrar_combustible_app: mensaje de no-retroceso unit-aware ─────
-- (La lógica de rendimiento/consumo se mantiene: para horómetro, la lectura es
--  horas y el rendimiento pasa a ser "h/gal" — métrica válida de consumo.)
create or replace function sgc.registrar_combustible_app(
  p_client_uuid uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_fecha date,
  p_kilometraje integer, p_galones numeric, p_monto numeric, p_estacion text default null::text,
  p_foto_recibo_path text default null::text, p_foto_tablero_path text default null::text,
  p_notas text default null::text, p_foto_bomba_path text default null::text,
  p_producto text default null::text, p_tarjeta text default null::text,
  p_titular text default null::text, p_titular_es_persona boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
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
    producto, tarjeta, titular, titular_es_persona
  ) values (
    v_id,
    case when v_persona then null else p_vehiculo_id end,
    p_conductor_id, coalesce(p_fecha, current_date),
    case when v_persona then null else p_kilometraje end,
    p_galones, p_monto, v_precio, v_km_anterior, v_km_recorridos, v_rendimiento, v_costo_km,
    nullif(p_estacion,''), nullif(p_notas,''), nullif(p_foto_recibo_path,''),
    nullif(p_foto_tablero_path,''), nullif(p_foto_bomba_path,''),
    v_alerta, v_motivo, p_client_uuid,
    nullif(p_producto,''), nullif(p_tarjeta,''), nullif(p_titular,''), coalesce(p_titular_es_persona,false)
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
$function$;

-- ── AA18.3 — v_vehiculo_stats: próximo mantenimiento unit-aware ───────────────
create or replace view sgc.v_vehiculo_stats
with (security_invoker = true) as
 SELECT v.id AS vehiculo_id,
    v.placa,
    v.kilometraje AS km_actual,
    COALESCE(fc.n_echadas, 0::bigint) AS combustible_echadas,
    COALESCE(fc.total_galones, 0::numeric) AS combustible_galones,
    COALESCE(fc.total_monto, 0::numeric) AS combustible_monto,
    fc.rendimiento_promedio,
    fc.costo_por_km_promedio,
    fc.ultima_echada,
    COALESCE(ck.n_checklists, 0::bigint) AS checklists_total,
    COALESCE(ck.n_bloqueos, 0::bigint) AS checklists_bloqueos,
    ck.ultimo_checklist,
    COALESCE(mt.n_mantenimientos, 0::bigint) AS mantenimientos_total,
    mt.ultimo_mantenimiento,
    v.km_ultimo_mantenimiento,
        CASE
            WHEN v.km_ultimo_mantenimiento IS NOT NULL AND (v.kilometraje IS NULL OR v.km_ultimo_mantenimiento <= v.kilometraje)
              THEN v.km_ultimo_mantenimiento + CASE WHEN COALESCE(v.medida_uso,'km') = 'horas'
                     THEN COALESCE(v.intervalo_mantenimiento_horas, 250)
                     ELSE COALESCE(v.intervalo_mantenimiento_km, 5000) END
            ELSE NULL::integer
        END AS proximo_mantenimiento_km,
    COALESCE(asg.n_activas, 0::bigint) AS asignaciones_activas,
    GREATEST(fc.ultima_echada, ck.ultimo_checklist, mt.ultimo_mantenimiento) AS ultima_actividad,
    v.km_ultimo_mantenimiento IS NOT NULL AND v.kilometraje IS NOT NULL AND v.km_ultimo_mantenimiento > v.kilometraje AS mantenimiento_por_revisar
   FROM sgc.vehiculos v
     LEFT JOIN ( SELECT registros_combustible.vehiculo_id,
            count(*) AS n_echadas,
            sum(registros_combustible.galones) AS total_galones,
            sum(registros_combustible.monto) AS total_monto,
            round(avg(registros_combustible.rendimiento_km_gal), 2) AS rendimiento_promedio,
            round(avg(registros_combustible.costo_por_km), 2) AS costo_por_km_promedio,
            max(registros_combustible.fecha) AS ultima_echada
           FROM sgc.registros_combustible
          GROUP BY registros_combustible.vehiculo_id) fc ON fc.vehiculo_id = v.id
     LEFT JOIN ( SELECT checklists_vehiculo.vehiculo_id,
            count(*) AS n_checklists,
            count(*) FILTER (WHERE checklists_vehiculo.resultado = 'bloqueado'::text) AS n_bloqueos,
            max(checklists_vehiculo.fecha) AS ultimo_checklist
           FROM sgc.checklists_vehiculo
          GROUP BY checklists_vehiculo.vehiculo_id) ck ON ck.vehiculo_id = v.id
     LEFT JOIN ( SELECT mantenimientos.vehiculo_id,
            count(*) AS n_mantenimientos,
            max(mantenimientos.fecha) AS ultimo_mantenimiento
           FROM sgc.mantenimientos
          GROUP BY mantenimientos.vehiculo_id) mt ON mt.vehiculo_id = v.id
     LEFT JOIN ( SELECT vehiculo_asignaciones.vehiculo_id,
            count(*) AS n_activas
           FROM sgc.vehiculo_asignaciones
          WHERE vehiculo_asignaciones.activa
          GROUP BY vehiculo_asignaciones.vehiculo_id) asg ON asg.vehiculo_id = v.id;
