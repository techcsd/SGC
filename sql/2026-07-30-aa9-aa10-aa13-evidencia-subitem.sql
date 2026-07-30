-- ============================================================================
-- PROMPT-10 FASE 4/5 — AA9/AA10/AA13: evidencia por sub-ítem
-- AA9  bitacora_restricciones.audio_path (voz por restricción)
-- AA10 bitacora_equipos_alquilados.fotos_paths[] (fotos múltiples de daño)
-- AA13 checklist_vehiculo_respuestas.foto_path/audio_path (foto+voz por falla)
-- Aditivo. RPCs crear_bitacora_app / registrar_checklist_vehiculo parcheados
-- (dump tras patch programático; solo cambian los INSERT de sub-ítems).
-- ============================================================================

alter table sgc.bitacora_restricciones add column if not exists audio_path text;
alter table sgc.bitacora_equipos_alquilados add column if not exists fotos_paths text[];
alter table sgc.checklist_vehiculo_respuestas add column if not exists foto_path text;
alter table sgc.checklist_vehiculo_respuestas add column if not exists audio_path text;

CREATE OR REPLACE FUNCTION sgc.crear_bitacora_app(p_id uuid, p_proyecto_id uuid, p_fecha date, p_tipo text, p_comentarios text DEFAULT NULL::text, p_personal_carpinteria smallint DEFAULT 0, p_personal_acero smallint DEFAULT 0, p_trabajadores_casa smallint DEFAULT 0, p_otro_personal text DEFAULT NULL::text, p_actividades jsonb DEFAULT '[]'::jsonb, p_restricciones jsonb DEFAULT '[]'::jsonb, p_incidente_tipo text DEFAULT NULL::text, p_incidente_gravedad text DEFAULT NULL::text, p_incidente_lesionados smallint DEFAULT 0, p_incidente_descripcion text DEFAULT NULL::text, p_incidente_acciones text DEFAULT NULL::text, p_fotos jsonb DEFAULT '[]'::jsonb, p_capturado_en timestamp with time zone DEFAULT now(), p_llovio boolean DEFAULT NULL::boolean, p_lluvia_detalle text DEFAULT NULL::text, p_hubo_migracion boolean DEFAULT NULL::boolean, p_migracion_obreros jsonb DEFAULT NULL::jsonb, p_hubo_equipos boolean DEFAULT NULL::boolean, p_equipos_alquilados jsonb DEFAULT '[]'::jsonb, p_bloque_entrepiso text DEFAULT NULL::text, p_ingeniero_responsable text DEFAULT NULL::text, p_hora_fin_trabajo time without time zone DEFAULT NULL::time without time zone, p_incidente_subcontratista text DEFAULT NULL::text, p_visita_tipo_visitante text DEFAULT NULL::text, p_visita_nombre text DEFAULT NULL::text, p_visita_organizacion text DEFAULT NULL::text, p_visita_motivo text DEFAULT NULL::text, p_incidente_equipo_nombre text DEFAULT NULL::text, p_incidente_equipo_alquilado boolean DEFAULT NULL::boolean, p_incidente_equipo_operativo boolean DEFAULT NULL::boolean, p_incidente_suceso text DEFAULT NULL::text, p_incidente_equipo_operativo_comentario text DEFAULT NULL::text, p_sin_actividad boolean DEFAULT false, p_motivo_sin_actividad text DEFAULT NULL::text, p_motivo_sin_actividad_detalle text DEFAULT NULL::text, p_horas_lluvia numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  c_min_fotos_parte     constant int := 2;
  c_min_fotos_incidente constant int := 1;
  v_uid    uuid := auth.uid();
  v_nfotos int  := jsonb_array_length(coalesce(p_fotos,'[]'::jsonb));
  v_obra   text;
  v_eq     jsonb;
  v_equipo text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;

  if exists (select 1 from sgc.bitacoras where id = p_id) then
    return p_id;
  end if;

  if coalesce(p_sin_actividad, false) and coalesce(trim(p_motivo_sin_actividad), '') = '' then
    raise exception 'Indica el motivo de por qué no se trabajó en obra';
  end if;

  -- Un parte "sin actividad" no exige fotos mínimas.
  if not coalesce(p_sin_actividad, false) then
    if p_tipo = 'parte_diario' and v_nfotos < c_min_fotos_parte then
      raise exception 'Agrega al menos % fotos del trabajo realizado', c_min_fotos_parte;
    end if;
    if p_tipo = 'incidente' and v_nfotos < c_min_fotos_incidente then
      raise exception 'Agrega al menos % foto del incidente', c_min_fotos_incidente;
    end if;
  end if;

  insert into sgc.bitacoras (
    id, usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados,
    incidente_descripcion, incidente_acciones,
    incidente_equipo_nombre, incidente_equipo_alquilado, incidente_equipo_operativo,
    incidente_equipo_operativo_comentario, incidente_suceso,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros, hubo_equipos_alquilados,
    sin_actividad, motivo_sin_actividad, motivo_sin_actividad_detalle, horas_lluvia
  ) values (
    p_id, v_uid, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    nullif(trim(p_bloque_entrepiso),''), nullif(trim(p_ingeniero_responsable),''), p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0),
    coalesce(p_trabajadores_casa, 0), p_otro_personal,
    nullif(trim(p_visita_tipo_visitante),''), nullif(trim(p_visita_nombre),''),
    nullif(trim(p_visita_organizacion),''), nullif(trim(p_visita_motivo),''),
    p_incidente_tipo, p_incidente_gravedad, nullif(trim(p_incidente_subcontratista),''),
    coalesce(p_incidente_lesionados, 0),
    p_incidente_descripcion, p_incidente_acciones,
    nullif(trim(p_incidente_equipo_nombre),''), p_incidente_equipo_alquilado, p_incidente_equipo_operativo,
    nullif(trim(p_incidente_equipo_operativo_comentario),''), nullif(trim(p_incidente_suceso),''),
    p_llovio, p_lluvia_detalle, p_hubo_migracion, p_migracion_obreros, p_hubo_equipos,
    coalesce(p_sin_actividad, false), nullif(trim(p_motivo_sin_actividad),''),
    nullif(trim(p_motivo_sin_actividad_detalle),''),
    case when coalesce(p_llovio,false) then p_horas_lluvia else null end
  );

  if p_tipo = 'parte_diario' and not coalesce(p_sin_actividad, false) then
    if jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad, unidad, bloque)
      select p_id, i->>'estructura', i->>'actividad',
             nullif(i->>'cantidad','')::numeric, nullif(i->>'unidad',''), nullif(trim(i->>'bloque'),'')
      from jsonb_array_elements(p_actividades) as i;

      insert into sgc.bitacora_catalogo_usos (proyecto_id, tipo, valor, usos, ultimo_uso)
      select p_proyecto_id, 'estructura', s.v, s.cnt, now() from (
        select trim(i->>'estructura') v, count(*) cnt
        from jsonb_array_elements(p_actividades) i
        where coalesce(trim(i->>'estructura'),'') <> '' group by trim(i->>'estructura')
      ) s
      on conflict (proyecto_id, tipo, valor)
      do update set usos = sgc.bitacora_catalogo_usos.usos + excluded.usos, ultimo_uso = now();

      insert into sgc.bitacora_catalogo_usos (proyecto_id, tipo, valor, usos, ultimo_uso)
      select p_proyecto_id, 'actividad', s.v, s.cnt, now() from (
        select trim(i->>'actividad') v, count(*) cnt
        from jsonb_array_elements(p_actividades) i
        where coalesce(trim(i->>'actividad'),'') <> '' group by trim(i->>'actividad')
      ) s
      on conflict (proyecto_id, tipo, valor)
      do update set usos = sgc.bitacora_catalogo_usos.usos + excluded.usos, ultimo_uso = now();
    end if;

    if jsonb_array_length(coalesce(p_restricciones, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro, foto_path, audio_path)
      select p_id, i->>'tipo_restriccion', i->>'descripcion_otro', i->>'foto_path', i->>'audio_path'
      from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  if v_nfotos > 0 then
    insert into sgc.bitacora_archivos (bitacora_id, nombre, url, tipo_mime)
    select p_id, coalesce(i->>'nombre', 'foto.jpg'), i->>'path', coalesce(i->>'tipo_mime', 'image/jpeg')
    from jsonb_array_elements(p_fotos) as i;
  end if;

  if p_tipo = 'incidente' and coalesce(trim(p_incidente_suceso),'') <> '' then
    if not exists (
      select 1 from sgc.bitacora_catalogos c
      where c.tipo in ('suceso_incidente','suceso_accidente','suceso_equipo')
        and upper(c.valor) = upper(trim(p_incidente_suceso))
    ) then
      begin perform sgc.registrar_otro_valor('bitacora_suceso', trim(p_incidente_suceso), p_id);
      exception when others then null; end;
    end if;
  end if;

  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    select nombre into v_obra from sgc.proyectos where id = p_proyecto_id;
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      v_equipo := trim(v_eq->>'equipo');
      if coalesce(v_equipo, '') <> '' then
        -- Z22 — foto_path opcional del equipo dañado (retrocompatible: nulo desde clientes viejos).
        insert into sgc.bitacora_equipos_alquilados
          (bitacora_id, equipo, uso, proveedor, para_retirar, danado, dano_detalle, foto_path, fotos_paths)
        values (p_id, v_equipo, nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''),
                coalesce((v_eq->>'para_retirar')::boolean, false),
                coalesce((v_eq->>'danado')::boolean, false),
                nullif(trim(v_eq->>'dano_detalle'),''),
                nullif(trim(v_eq->>'foto_path'),''), (select array_agg(value) from jsonb_array_elements_text(coalesce(v_eq->'fotos_paths','[]'::jsonb))));
        begin perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', v_equipo, p_id);
        exception when others then null; end;

        if coalesce((v_eq->>'para_retirar')::boolean, false) then
          perform sgc.notificar_rol('chofer_transportista', 'flota',
            'Retirar ' || v_equipo,
            'Retirar ' || v_equipo || ' de ' || coalesce(v_obra, 'la obra'),
            '/bitacora/historial?item=' || p_id::text);
          perform sgc.notificar_flota_elevado('flota',
            'Equipo para retirar',
            v_equipo || ' — ' || coalesce(v_obra, 'obra'),
            '/bitacora/historial?item=' || p_id::text);
        end if;
        if coalesce((v_eq->>'danado')::boolean, false) then
          perform sgc.notificar_flota_elevado('alerta',
            'Equipo dañado',
            v_equipo || coalesce(': ' || nullif(trim(v_eq->>'dano_detalle'),''), '') || ' — ' || coalesce(v_obra, 'obra'),
            '/bitacora/historial?item=' || p_id::text);
        end if;
      end if;
    end loop;
  end if;

  return p_id;
end;
$function$


CREATE OR REPLACE FUNCTION sgc.registrar_checklist_vehiculo(p_id uuid, p_plantilla_id uuid, p_vehiculo_id uuid, p_conductor_id uuid, p_tipo text, p_fecha date, p_datos jsonb, p_kilometraje numeric, p_respuestas jsonb, p_fotos jsonb, p_firma_path text, p_observaciones text, p_capturado_en timestamp with time zone, p_nivel_combustible text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
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

  insert into sgc.checklist_vehiculo_respuestas (checklist_id, etiqueta, seccion, es_critico, respuesta, comentario, orden, foto_path, audio_path)
  select p_id, r->>'etiqueta', r->>'seccion',
         coalesce((r->>'es_critico')::boolean, false),
         coalesce(lower(r->>'respuesta'), 'na'),
         r->>'comentario',
         coalesce((r->>'orden')::int, 0), r->>'foto_path', r->>'audio_path'
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
$function$

