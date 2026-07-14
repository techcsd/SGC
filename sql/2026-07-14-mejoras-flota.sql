-- ============================================================================
-- Mejoras 14/07/2026 — Flota (R1, R2, R4, R5, R6)
-- ----------------------------------------------------------------------------
-- Migración ADITIVA y RETROCOMPATIBLE. La app móvil en producción llama
-- `registrar_checklist_vehiculo`, `crear_entrega_vehiculo`, `crear_mantenimiento_app`,
-- `mis_pendientes_transporte`; esos contratos NO se rompen.
--
--   R1  sgc.vehiculo_asignaciones (multi-asignación) + RPC asignarme_vehiculo
--   R2  RPC auto_registrar_conductor (sin aprobación, vinculado a auth.uid())
--   R4  vista sgc.v_vehiculo_stats
--   R5  vista sgc.v_conductor_stats
--   R6  vehículo con bloqueo -> estado 'no_disponible'; RPC reactivar_vehiculo
-- ============================================================================

set search_path = sgc, public;

-- ── R1) Multi-asignación de vehículos ───────────────────────────────────────
create table if not exists sgc.vehiculo_asignaciones (
  id            uuid primary key default gen_random_uuid(),
  vehiculo_id   uuid not null references sgc.vehiculos(id)   on delete cascade,
  usuario_id    uuid          references sgc.usuarios(id)    on delete set null,
  conductor_id  uuid          references sgc.conductores(id) on delete set null,
  desde         timestamptz not null default now(),
  hasta         timestamptz,
  activa        boolean not null default true,
  origen        text not null default 'admin',   -- 'admin' | 'auto'
  notas         text,
  client_uuid   uuid,                              -- idempotencia auto-asignación app
  created_at    timestamptz not null default now(),
  constraint vehiculo_asignaciones_origen_chk check (origen in ('admin','auto'))
);
-- Una persona no puede tener dos asignaciones ACTIVAS del mismo vehículo.
create unique index if not exists uq_veh_asig_activa
  on sgc.vehiculo_asignaciones(vehiculo_id, usuario_id) where activa;
create unique index if not exists uq_veh_asig_client_uuid
  on sgc.vehiculo_asignaciones(client_uuid) where client_uuid is not null;
create index if not exists idx_veh_asig_veh     on sgc.vehiculo_asignaciones(vehiculo_id) where activa;
create index if not exists idx_veh_asig_usuario on sgc.vehiculo_asignaciones(usuario_id) where activa;

alter table sgc.vehiculo_asignaciones enable row level security;
-- Lectura: flota/admin ven todo; cualquier usuario ve SUS propias asignaciones.
drop policy if exists veh_asig_sel on sgc.vehiculo_asignaciones;
create policy veh_asig_sel on sgc.vehiculo_asignaciones for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota') or usuario_id = auth.uid());
-- Escritura directa: solo flota/admin (la auto-asignación va por RPC SECURITY DEFINER).
drop policy if exists veh_asig_all on sgc.vehiculo_asignaciones;
create policy veh_asig_all on sgc.vehiculo_asignaciones for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'))
  with check (sgc.is_admin() or sgc.tiene_modulo('flota'));

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.vehiculo_asignaciones to authenticated;
grant all on sgc.vehiculo_asignaciones to service_role;

do $$ begin
  alter publication supabase_realtime add table sgc.vehiculo_asignaciones;
exception when duplicate_object then null; end $$;

-- RPC: auto-asignarme un vehículo (cualquier usuario autenticado).
-- Idempotente por client_uuid. Devuelve lo necesario para el reporte de
-- recibimiento (crear_entrega_vehiculo): datos del vehículo + asignación.
create or replace function sgc.asignarme_vehiculo(
  p_vehiculo_id uuid,
  p_client_uuid uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid       uuid := auth.uid();
  v_asig_id   uuid;
  v_cond_id   uuid;
  v_estado    text;
  v_activo    boolean;
  v_km_ult    int;
  v_intervalo int;
  v_veh       record;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Idempotencia: reenvío del mismo op devuelve la asignación existente.
  if p_client_uuid is not null then
    select id into v_asig_id from sgc.vehiculo_asignaciones where client_uuid = p_client_uuid;
    if v_asig_id is not null then
      return (select to_jsonb(a) from sgc.vehiculo_asignaciones a where a.id = v_asig_id);
    end if;
  end if;

  select estado, coalesce(activo, true), km_ultimo_mantenimiento, intervalo_mantenimiento_km
    into v_estado, v_activo, v_km_ult, v_intervalo
    from sgc.vehiculos where id = p_vehiculo_id;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not v_activo or v_estado in ('baja','no_disponible') then
    raise exception 'El vehículo no está disponible (estado: %).', v_estado;
  end if;

  -- Conductor vinculado a este usuario (si ya se auto-registró).
  select id into v_cond_id from sgc.conductores where usuario_id = v_uid and activo limit 1;

  -- Si ya tiene una asignación activa, la reutiliza (no duplica).
  select id into v_asig_id
    from sgc.vehiculo_asignaciones
   where vehiculo_id = p_vehiculo_id and usuario_id = v_uid and activa
   limit 1;

  if v_asig_id is null then
    insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, conductor_id, origen, client_uuid)
    values (p_vehiculo_id, v_uid, v_cond_id, 'auto', p_client_uuid)
    returning id into v_asig_id;
  end if;

  -- Mantener responsable_id como principal (compatibilidad) si estaba vacío.
  update sgc.vehiculos set responsable_id = v_uid
   where id = p_vehiculo_id and responsable_id is null;

  select placa, marca, modelo, tipo, kilometraje, vencimiento_matricula, vencimiento_seguro
    into v_veh
    from sgc.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'asignacion_id',         v_asig_id,
    'vehiculo_id',           p_vehiculo_id,
    'conductor_id',          v_cond_id,
    'placa',                 v_veh.placa,
    'marca',                 v_veh.marca,
    'modelo',                v_veh.modelo,
    'tipo',                  v_veh.tipo,
    'kilometraje',           v_veh.kilometraje,
    'vencimiento_matricula', v_veh.vencimiento_matricula,
    'vencimiento_seguro',    v_veh.vencimiento_seguro,
    'proximo_mantenimiento_km',
        case when v_km_ult is not null then v_km_ult + coalesce(v_intervalo,5000) else null end
  );
end;
$$;
grant execute on function sgc.asignarme_vehiculo(uuid, uuid) to authenticated, service_role;

-- ── R2) Auto-registro de conductor (sin aprobación) ─────────────────────────
create or replace function sgc.auto_registrar_conductor(
  p_cedula                   text,
  p_licencia_tipo            text,
  p_licencia_numero          text default null,
  p_licencia_vencimiento     date default null,
  p_tipo_vehiculo_autorizado text default 'Ambos'
) returns jsonb
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid      uuid := auth.uid();
  v_nombre   text;
  v_tel      text;
  v_cond_id  uuid;
  v_lic_venc date;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(p_cedula),'') is null then raise exception 'La cédula es obligatoria'; end if;
  if nullif(trim(p_licencia_tipo),'') is null then raise exception 'El tipo de licencia es obligatorio'; end if;
  if coalesce(p_tipo_vehiculo_autorizado,'Ambos') not in ('Liviano','Pesado','Ambos') then
    raise exception 'Tipo de vehículo autorizado inválido';
  end if;

  select nombre into v_nombre from sgc.usuarios where id = v_uid;

  -- 1) Ya es conductor vinculado a este usuario -> actualizar.
  select id into v_cond_id from sgc.conductores where usuario_id = v_uid limit 1;

  -- 2) Existe un conductor con esa cédula sin usuario -> vincularlo.
  if v_cond_id is null then
    select id into v_cond_id from sgc.conductores
     where cedula = trim(p_cedula) and usuario_id is null limit 1;
  end if;

  if v_cond_id is not null then
    update sgc.conductores set
      cedula                   = trim(p_cedula),
      nombre                   = coalesce(nombre, v_nombre),
      licencia_tipo            = trim(p_licencia_tipo),
      licencia_numero          = nullif(trim(p_licencia_numero),''),
      licencia_vencimiento     = p_licencia_vencimiento,
      tipo_vehiculo_autorizado = coalesce(p_tipo_vehiculo_autorizado,'Ambos'),
      usuario_id               = v_uid,
      activo                   = true,
      updated_at               = now()
    where id = v_cond_id;
  else
    insert into sgc.conductores (
      cedula, nombre, telefono, licencia_tipo, licencia_numero, licencia_vencimiento,
      tipo_vehiculo_autorizado, usuario_id, activo
    ) values (
      trim(p_cedula), coalesce(v_nombre,'Conductor'), null, trim(p_licencia_tipo),
      nullif(trim(p_licencia_numero),''), p_licencia_vencimiento,
      coalesce(p_tipo_vehiculo_autorizado,'Ambos'), v_uid, true
    ) returning id into v_cond_id;
  end if;

  select licencia_vencimiento into v_lic_venc from sgc.conductores where id = v_cond_id;

  return jsonb_build_object(
    'conductor_id', v_cond_id,
    'licencia_vencida', (v_lic_venc is not null and v_lic_venc < current_date),
    'licencia_vencimiento', v_lic_venc
  );
end;
$$;
grant execute on function sgc.auto_registrar_conductor(text, text, text, date, text)
  to authenticated, service_role;

-- ── R4) Vista de stats por vehículo ─────────────────────────────────────────
create or replace view sgc.v_vehiculo_stats
with (security_invoker = true) as
select
  v.id                                          as vehiculo_id,
  v.placa,
  v.kilometraje                                 as km_actual,
  -- Combustible
  coalesce(fc.n_echadas, 0)                     as combustible_echadas,
  coalesce(fc.total_galones, 0)                 as combustible_galones,
  coalesce(fc.total_monto, 0)                   as combustible_monto,
  fc.rendimiento_promedio,
  fc.costo_por_km_promedio,
  fc.ultima_echada,
  -- Checklists
  coalesce(ck.n_checklists, 0)                  as checklists_total,
  coalesce(ck.n_bloqueos, 0)                    as checklists_bloqueos,
  ck.ultimo_checklist,
  -- Mantenimientos
  coalesce(mt.n_mantenimientos, 0)              as mantenimientos_total,
  mt.ultimo_mantenimiento,
  v.km_ultimo_mantenimiento,
  case when v.km_ultimo_mantenimiento is not null
       then v.km_ultimo_mantenimiento + coalesce(v.intervalo_mantenimiento_km, 5000)
       else null end                            as proximo_mantenimiento_km,
  -- Asignaciones
  coalesce(asg.n_activas, 0)                    as asignaciones_activas,
  -- Última actividad (cualquier registro)
  greatest(fc.ultima_echada, ck.ultimo_checklist, mt.ultimo_mantenimiento) as ultima_actividad
from sgc.vehiculos v
left join (
  select vehiculo_id, count(*) n_echadas, sum(galones) total_galones, sum(monto) total_monto,
         round(avg(rendimiento_km_gal), 2) rendimiento_promedio,
         round(avg(costo_por_km), 2) costo_por_km_promedio,
         max(fecha) ultima_echada
    from sgc.registros_combustible group by vehiculo_id
) fc on fc.vehiculo_id = v.id
left join (
  select vehiculo_id, count(*) n_checklists,
         count(*) filter (where resultado = 'bloqueado') n_bloqueos,
         max(fecha) ultimo_checklist
    from sgc.checklists_vehiculo group by vehiculo_id
) ck on ck.vehiculo_id = v.id
left join (
  select vehiculo_id, count(*) n_mantenimientos, max(fecha) ultimo_mantenimiento
    from sgc.mantenimientos group by vehiculo_id
) mt on mt.vehiculo_id = v.id
left join (
  select vehiculo_id, count(*) n_activas
    from sgc.vehiculo_asignaciones where activa group by vehiculo_id
) asg on asg.vehiculo_id = v.id;
grant select on sgc.v_vehiculo_stats to authenticated, service_role;

-- ── R5) Vista de stats por conductor ────────────────────────────────────────
create or replace view sgc.v_conductor_stats
with (security_invoker = true) as
select
  c.id                                          as conductor_id,
  c.nombre,
  c.licencia_vencimiento,
  case
    when c.licencia_vencimiento is null then 'sin_dato'
    when c.licencia_vencimiento < current_date then 'vencida'
    when c.licencia_vencimiento <= current_date + 30 then 'por_vencer'
    else 'vigente'
  end                                           as estado_licencia,
  coalesce(ck.n_checklists, 0)                  as checklists_total,
  coalesce(ck.n_bloqueos, 0)                    as checklists_bloqueos,
  ck.ultimo_checklist,
  coalesce(fc.n_echadas, 0)                     as combustible_echadas,
  fc.ultima_echada,
  coalesce(uv.vehiculos_usados, 0)              as vehiculos_usados,
  greatest(ck.ultimo_checklist, fc.ultima_echada) as ultima_actividad
from sgc.conductores c
left join (
  select conductor_id, count(*) n_checklists,
         count(*) filter (where resultado = 'bloqueado') n_bloqueos,
         max(fecha) ultimo_checklist
    from sgc.checklists_vehiculo where conductor_id is not null group by conductor_id
) ck on ck.conductor_id = c.id
left join (
  select conductor_id, count(*) n_echadas, max(fecha) ultima_echada
    from sgc.registros_combustible where conductor_id is not null group by conductor_id
) fc on fc.conductor_id = c.id
left join (
  select conductor_id, count(distinct vehiculo_id) vehiculos_usados
    from sgc.checklists_vehiculo where conductor_id is not null group by conductor_id
) uv on uv.conductor_id = c.id;
grant select on sgc.v_conductor_stats to authenticated, service_role;

-- ── R6) Vehículo bloqueado -> 'no_disponible' + reactivar ────────────────────
-- El RPC registrar_checklist_vehiculo se re-crea con el MISMO contrato de 14
-- args (retrocompatible), agregando: al resultado 'bloqueado' pone el vehículo
-- en estado 'no_disponible' (además de los avisos ya existentes).
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

  if exists (select 1 from sgc.checklists_vehiculo where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

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
    select valor into v_umbral_pre from sgc.flota_config where clave = 'umbral_precita_km';
    v_umbral_pre := coalesce(v_umbral_pre, 500);
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

  if v_resultado = 'bloqueado' then
    -- R6: el vehículo queda fuera de servicio hasta que flota lo reactive.
    update sgc.vehiculos set estado = 'no_disponible'
     where id = p_vehiculo_id and estado <> 'baja';
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

-- RPC: reactivar un vehículo bloqueado (flota/admin). Atiende sus avisos de bloqueo.
create or replace function sgc.reactivar_vehiculo(p_id uuid, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No autorizado';
  end if;
  update sgc.vehiculos set estado = 'activo'
   where id = p_id and estado = 'no_disponible';
  update sgc.avisos_flota
     set estado = 'atendido', atendido_por = auth.uid(), atendido_at = now(),
         nota_atencion = coalesce(nullif(p_nota,''), 'Vehículo reactivado')
   where vehiculo_id = p_id and tipo = 'bloqueo_critico' and estado = 'pendiente';
end;
$$;
grant execute on function sgc.reactivar_vehiculo(uuid, text) to authenticated, service_role;
