-- ============================================================================
-- Flota v2 — correcciones de auditoría (2026-07-14). Aplicado a prod.
--  1. Índice dedup NO parcial: `ON CONFLICT (dedup_key)` no puede casar un índice
--     parcial (where dedup_key is not null) -> los avisos de vencimiento del web
--     lanzaban 42P10 (silenciado) y nunca se creaban. NULLs siguen distintos.
--  2. REVOKE de notificar_modulo a authenticated (solo lo usan RPC definer).
--  3. registrar_checklist_vehiculo: los avisos de estado (vencido/pre_cita) solo se
--     insertan/notifican si no hay ya uno pendiente del vehiculo (anti-flood).
-- ============================================================================
drop index if exists sgc.uq_avisos_flota_dedup;
create unique index uq_avisos_flota_dedup on sgc.avisos_flota(dedup_key);

revoke execute on function sgc.notificar_modulo(text,text,text,text,text) from authenticated;

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

  -- Aviso de estado (vencido/pre_cita): solo si NO hay ya uno pendiente para el
  -- vehículo, para no inundar avisos + notificaciones en cada pre-uso. Vuelve a
  -- avisar cuando el anterior se marque atendido.
  if v_alerta_mant = 'vencido'
     and not exists (select 1 from sgc.avisos_flota a
       where a.vehiculo_id = p_vehiculo_id and a.tipo = 'mantenimiento_vencido' and a.estado = 'pendiente') then
    insert into sgc.avisos_flota (tipo, vehiculo_id, conductor_id, referencia_id, mensaje, severidad)
    values ('mantenimiento_vencido', p_vehiculo_id, p_conductor_id, p_id,
      format('Mantenimiento VENCIDO en %s (%s km pasados del próximo).', coalesce(v_placa,''), abs(v_faltan)), 'alta');
    perform sgc.notificar_modulo('flota', 'warning',
      'Mantenimiento vencido',
      format('%s superó su intervalo de mantenimiento.', coalesce(v_placa,'Un vehículo')),
      '/flota/mantenimientos');
  elsif v_alerta_mant = 'pre_cita'
     and not exists (select 1 from sgc.avisos_flota a
       where a.vehiculo_id = p_vehiculo_id and a.tipo = 'pre_cita' and a.estado = 'pendiente') then
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
$function$

