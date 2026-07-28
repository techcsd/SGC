-- ============================================================================
-- Y15 — Cronograma de Proyectos · FASE 1/2 (RPCs + auto-ajuste + sweep)
-- Ronda 28/07/2026 · PROMPT-3
-- ============================================================================
-- Todos SECURITY DEFINER, search_path fijo, idempotentes (aptos para outbox).
-- ============================================================================

-- 0) Recálculo del timeline (idempotente) -------------------------------------
-- Reencadena las fechas plan de las tareas NO completadas por `orden`. Las
-- completadas conservan su plan (baseline) y su fecha_fin_real mueve el ancla.
create or replace function sgc.recalcular_cronograma(p_proyecto_id uuid)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_ancla date;
  r record;
begin
  -- Guard: si lo llama un usuario, debe poder gestionar. El sweep (auth.uid() null) pasa.
  if auth.uid() is not null and not sgc.puede_gestionar_cronograma(p_proyecto_id) then
    raise exception 'Sin permiso para el cronograma de este proyecto' using errcode = '42501';
  end if;

  v_ancla := coalesce(
    (select fecha_inicio_plan from sgc.cronograma_tareas
      where proyecto_id = p_proyecto_id order by orden, created_at limit 1),
    (select fecha_inicio from sgc.proyectos where id = p_proyecto_id),
    current_date
  );

  for r in
    select * from sgc.cronograma_tareas
    where proyecto_id = p_proyecto_id
    order by orden, created_at
  loop
    if r.estado = 'completada' and r.fecha_fin_real is not null then
      v_ancla := r.fecha_fin_real + 1;
    else
      update sgc.cronograma_tareas
        set fecha_inicio_plan = v_ancla,
            fecha_fin_plan     = v_ancla + (greatest(r.duracion_dias_plan,1) - 1),
            updated_at         = now()
      where id = r.id;
      v_ancla := v_ancla + greatest(r.duracion_dias_plan,1);
    end if;
  end loop;
end;
$$;
grant execute on function sgc.recalcular_cronograma(uuid) to authenticated, service_role;

-- 1) Crear tarea --------------------------------------------------------------
create or replace function sgc.crear_tarea_cronograma(
  p_proyecto_id        uuid,
  p_nombre             text,
  p_tipo               text default 'ordinaria',
  p_duracion_dias_plan int default 1,
  p_orden              int default null,
  p_fase_id            uuid default null,
  p_descripcion        text default null,
  p_fecha_inicio_plan  date default null,
  p_es_prueba          boolean default false,
  p_id                 uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_orden int;
begin
  if not sgc.puede_gestionar_cronograma(p_proyecto_id) then
    raise exception 'Sin permiso para el cronograma de este proyecto' using errcode = '42501';
  end if;
  if p_nombre is null or length(trim(p_nombre)) = 0 then
    raise exception 'nombre requerido' using errcode = '22023';
  end if;

  -- Idempotencia por id (outbox): si ya existe, no dupliques.
  if exists (select 1 from sgc.cronograma_tareas where id = v_id) then
    return v_id;
  end if;

  v_orden := coalesce(p_orden,
    (select coalesce(max(orden),0)+1 from sgc.cronograma_tareas where proyecto_id = p_proyecto_id));

  insert into sgc.cronograma_tareas (
    id, proyecto_id, fase_id, nombre, descripcion, tipo, orden,
    duracion_dias_plan, fecha_inicio_plan, es_prueba
  ) values (
    v_id, p_proyecto_id, p_fase_id, trim(p_nombre), p_descripcion,
    coalesce(p_tipo,'ordinaria'), v_orden,
    greatest(coalesce(p_duracion_dias_plan,1),1), p_fecha_inicio_plan,
    coalesce(p_es_prueba,false)
  );

  perform sgc.recalcular_cronograma(p_proyecto_id);
  return v_id;
end;
$$;
grant execute on function sgc.crear_tarea_cronograma(uuid,text,text,int,int,uuid,text,date,boolean,uuid) to authenticated, service_role;

-- 2) Iniciar tarea ------------------------------------------------------------
create or replace function sgc.iniciar_tarea(
  p_tarea_id     uuid,
  p_fecha_inicio date default null
)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_tarea sgc.cronograma_tareas;
begin
  select * into v_tarea from sgc.cronograma_tareas where id = p_tarea_id;
  if not found then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_cronograma(v_tarea.proyecto_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  if v_tarea.estado <> 'pendiente' then
    return;  -- idempotente: ya iniciada o completada
  end if;

  update sgc.cronograma_tareas
    set estado = 'en_curso',
        fecha_inicio_real = coalesce(p_fecha_inicio, current_date),
        iniciada_por = auth.uid(),
        updated_at = now()
  where id = p_tarea_id;

  -- auto-resolver aviso "por iniciar"
  update sgc.avisos_proyecto
    set estado = 'resuelto_auto', resuelto_at = now(), resuelto_nota = 'Tarea iniciada'
  where dedup_key = 'crono:' || p_tarea_id || ':por_iniciar' and estado = 'pendiente';
end;
$$;
grant execute on function sgc.iniciar_tarea(uuid,date) to authenticated, service_role;

-- 3) Completar tarea (foto obligatoria; justificación si tarde; recálculo en tx)
create or replace function sgc.completar_tarea(
  p_tarea_id      uuid,
  p_foto_path     text,
  p_justificacion text default null,
  p_fecha_fin     date default null
)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_tarea sgc.cronograma_tareas;
  v_fin date;
  v_tarde boolean;
  v_surplus int;
  v_delay int;
  v_destino uuid;
begin
  select * into v_tarea from sgc.cronograma_tareas where id = p_tarea_id;
  if not found then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_cronograma(v_tarea.proyecto_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  if v_tarea.estado = 'completada' then
    return;  -- idempotente
  end if;
  if p_foto_path is null or length(trim(p_foto_path)) = 0 then
    raise exception 'Foto de evidencia requerida para completar' using errcode = '22023';
  end if;

  v_fin := coalesce(p_fecha_fin, current_date);
  v_tarde := v_tarea.fecha_fin_plan is not null and v_fin > v_tarea.fecha_fin_plan;

  if v_tarde and coalesce(nullif(trim(p_justificacion),''), v_tarea.justificacion_retraso) is null then
    raise exception 'Justificación requerida: la tarea se completa tarde' using errcode = '22023';
  end if;

  update sgc.cronograma_tareas
    set estado = 'completada',
        fecha_fin_real = v_fin,
        foto_evidencia_path = p_foto_path,
        justificacion_retraso = coalesce(nullif(trim(p_justificacion),''), justificacion_retraso),
        completada_por = auth.uid(),
        updated_at = now()
  where id = p_tarea_id;

  -- Auto-ajuste: adelanto dona días a la próxima crítica/importante; retraso empuja.
  if v_tarea.fecha_fin_plan is not null and v_fin < v_tarea.fecha_fin_plan then
    v_surplus := v_tarea.fecha_fin_plan - v_fin;
    select id into v_destino from sgc.cronograma_tareas
      where proyecto_id = v_tarea.proyecto_id
        and estado <> 'completada'
        and orden > v_tarea.orden
        and tipo in ('importante','critica')
      order by orden limit 1;
    if v_destino is not null then
      update sgc.cronograma_tareas
        set duracion_dias_plan = duracion_dias_plan + v_surplus, updated_at = now()
      where id = v_destino;
      insert into sgc.cronograma_recalculos (proyecto_id, tarea_origen_id, tarea_destino_id, dias_movidos, motivo, creado_por, detalle)
      values (v_tarea.proyecto_id, p_tarea_id, v_destino, v_surplus, 'adelanto_dona_critica', auth.uid(),
              jsonb_build_object('fin_plan', v_tarea.fecha_fin_plan, 'fin_real', v_fin));
    else
      insert into sgc.cronograma_recalculos (proyecto_id, tarea_origen_id, tarea_destino_id, dias_movidos, motivo, creado_por, detalle)
      values (v_tarea.proyecto_id, p_tarea_id, null, v_surplus, 'holgura_general', auth.uid(),
              jsonb_build_object('fin_plan', v_tarea.fecha_fin_plan, 'fin_real', v_fin));
    end if;
  elsif v_tarea.fecha_fin_plan is not null and v_fin > v_tarea.fecha_fin_plan then
    v_delay := v_fin - v_tarea.fecha_fin_plan;
    insert into sgc.cronograma_recalculos (proyecto_id, tarea_origen_id, tarea_destino_id, dias_movidos, motivo, creado_por, detalle)
    values (v_tarea.proyecto_id, p_tarea_id, null, -v_delay, 'retraso_empuje', auth.uid(),
            jsonb_build_object('fin_plan', v_tarea.fecha_fin_plan, 'fin_real', v_fin));
  end if;

  -- Reencadena el timeline en la MISMA transacción.
  perform sgc.recalcular_cronograma(v_tarea.proyecto_id);

  -- auto-resolver avisos de esta tarea
  update sgc.avisos_proyecto
    set estado = 'resuelto_auto', resuelto_at = now(), resuelto_nota = 'Tarea completada'
  where referencia_id = p_tarea_id and tipo like 'cronograma_%' and estado = 'pendiente';
end;
$$;
grant execute on function sgc.completar_tarea(uuid,text,text,date) to authenticated, service_role;

-- 4) Justificar retraso -------------------------------------------------------
create or replace function sgc.justificar_retraso(
  p_tarea_id      uuid,
  p_justificacion text
)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_proyecto uuid;
begin
  select proyecto_id into v_proyecto from sgc.cronograma_tareas where id = p_tarea_id;
  if not found then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_cronograma(v_proyecto) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_justificacion is null or length(trim(p_justificacion)) = 0 then
    raise exception 'Justificación requerida' using errcode = '22023';
  end if;
  update sgc.cronograma_tareas
    set justificacion_retraso = trim(p_justificacion), updated_at = now()
  where id = p_tarea_id;
end;
$$;
grant execute on function sgc.justificar_retraso(uuid,text) to authenticated, service_role;

-- 5) Enlazar bitácora ↔ tarea (opcionalmente completar) -----------------------
create or replace function sgc.enlazar_bitacora_tarea(
  p_tarea_id   uuid,
  p_bitacora_id uuid,
  p_completar  boolean default false,
  p_foto_path  text default null
)
returns void
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_proyecto uuid;
begin
  select proyecto_id into v_proyecto from sgc.cronograma_tareas where id = p_tarea_id;
  if not found then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if not sgc.puede_gestionar_cronograma(v_proyecto) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  insert into sgc.cronograma_tarea_bitacoras (tarea_id, bitacora_id)
  values (p_tarea_id, p_bitacora_id)
  on conflict (tarea_id, bitacora_id) do nothing;

  if p_completar then
    -- completar exige foto: usa la provista (la app puede pasar una foto de la bitácora)
    perform sgc.completar_tarea(p_tarea_id, p_foto_path, null, null);
  end if;
end;
$$;
grant execute on function sgc.enlazar_bitacora_tarea(uuid,uuid,boolean,text) to authenticated, service_role;

-- 6) Listar cronograma (lectura) ----------------------------------------------
create or replace function sgc.listar_cronograma(p_proyecto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = sgc, public
as $$
declare
  v_result jsonb;
begin
  if not sgc.puede_ver_cronograma(p_proyecto_id) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'tareas', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.orden, t.created_at)
      from sgc.cronograma_tareas t
      where t.proyecto_id = p_proyecto_id and ((not t.es_prueba) or sgc.is_admin())
    ), '[]'::jsonb),
    'recalculos', coalesce((
      select jsonb_agg(to_jsonb(rc) order by rc.created_at desc)
      from sgc.cronograma_recalculos rc
      where rc.proyecto_id = p_proyecto_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
grant execute on function sgc.listar_cronograma(uuid) to authenticated, service_role;

-- 7) Sweep de avisos (pg_cron) ------------------------------------------------
-- Genera avisos por_iniciar / por_vencer / atrasada con dedup estable + bell +
-- email (net.http_post best-effort), y auto-resuelve los que ya no aplican.
create or replace function sgc.evaluar_avisos_cronograma()
returns int
language plpgsql
security definer
set search_path = sgc, public, vault
as $$
declare
  r record;
  v_kind text;
  v_sev text;
  v_msg text;
  v_dedup text;
  v_was_insert boolean;
  v_n int := 0;
  v_secret text;
  v_proj_ref text := 'jeeqhgccqefbqilntcpu';
  resp record;
begin
  -- Auto-resolución: avisos de tareas completadas, o "por_iniciar" de tareas ya iniciadas.
  update sgc.avisos_proyecto a
    set estado='resuelto_auto', resuelto_at=now(), resuelto_nota='Tarea completada'
  where a.tipo like 'cronograma_%' and a.estado='pendiente'
    and a.referencia_id in (select id from sgc.cronograma_tareas where estado='completada');
  update sgc.avisos_proyecto a
    set estado='resuelto_auto', resuelto_at=now(), resuelto_nota='Tarea iniciada'
  where a.tipo='cronograma_por_iniciar' and a.estado='pendiente'
    and a.referencia_id in (select id from sgc.cronograma_tareas where estado<>'pendiente');

  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name='cronograma_sync_secret';
  exception when others then v_secret := null; end;

  for r in
    select t.*, p.nombre as proyecto_nombre
    from sgc.cronograma_tareas t
    join sgc.proyectos p on p.id = t.proyecto_id
    where t.estado <> 'completada'
      and not t.es_prueba
      and coalesce(p.activo, true)
      and p.estado not in ('completado','cancelado')
  loop
    v_kind := null;
    if r.estado = 'pendiente' and r.fecha_inicio_plan is not null
       and r.fecha_inicio_plan between current_date and current_date + 3 then
      v_kind := 'por_iniciar'; v_sev := 'media';
      v_msg := 'La tarea «'||r.nombre||'» inicia el '||to_char(r.fecha_inicio_plan,'DD/MM/YYYY')||'.';
    end if;
    if r.fecha_fin_plan is not null and r.fecha_fin_plan < current_date then
      v_kind := 'atrasada'; v_sev := 'alta';
      v_msg := 'La tarea «'||r.nombre||'» está atrasada (vencía el '||to_char(r.fecha_fin_plan,'DD/MM/YYYY')||'). Requiere justificación.';
    elsif r.fecha_fin_plan is not null and r.fecha_fin_plan between current_date and current_date + 2 then
      v_kind := 'por_vencer'; v_sev := 'media';
      v_msg := 'La tarea «'||r.nombre||'» vence el '||to_char(r.fecha_fin_plan,'DD/MM/YYYY')||'.';
    end if;

    if v_kind is null then continue; end if;

    v_dedup := 'crono:'||r.id||':'||v_kind;
    insert into sgc.avisos_proyecto (tipo, proyecto_id, referencia_id, mensaje, severidad, estado, dedup_key)
    values ('cronograma_'||v_kind, r.proyecto_id, r.id, v_msg, v_sev, 'pendiente', v_dedup)
    on conflict (dedup_key) where dedup_key is not null do update
      set mensaje = excluded.mensaje, severidad = excluded.severidad,
          estado = case when sgc.avisos_proyecto.estado = 'resuelto_auto' then 'pendiente' else sgc.avisos_proyecto.estado end
    returning (xmax = 0) into v_was_insert;

    if v_was_insert then
      v_n := v_n + 1;
      -- bell a cada responsable del proyecto
      for resp in
        select pr.usuario_id from sgc.proyecto_responsables pr
        where pr.proyecto_id = r.proyecto_id and pr.activo
      loop
        perform sgc.notificar(resp.usuario_id, case when v_kind='atrasada' then 'error' else 'warning' end,
          'Cronograma: '||r.proyecto_nombre, v_msg,
          '/proyectos/'||r.proyecto_id||'/cronograma?tarea='||r.id);
      end loop;

      -- email best-effort (si hay secreto y net disponible)
      if v_secret is not null then
        begin
          perform net.http_post(
            url := 'https://'||v_proj_ref||'.supabase.co/functions/v1/notificar-cronograma',
            headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', v_secret),
            body := jsonb_build_object('proyecto_id', r.proyecto_id, 'tarea_id', r.id,
                     'tipo', v_kind, 'tarea', r.nombre, 'proyecto', r.proyecto_nombre, 'mensaje', v_msg)
          );
          update sgc.avisos_proyecto set email_enviado_at = now() where dedup_key = v_dedup;
        exception when others then null; end;
      end if;
    end if;
  end loop;

  return v_n;
end;
$$;
revoke all on function sgc.evaluar_avisos_cronograma() from public, anon, authenticated;
grant execute on function sgc.evaluar_avisos_cronograma() to service_role;

-- 8) pg_cron: sweep diario 06:15 ----------------------------------------------
do $$ begin perform cron.unschedule('sgc-cronograma-avisos'); exception when others then null; end $$;
select cron.schedule('sgc-cronograma-avisos', '15 6 * * *',
  $cron$ select sgc.evaluar_avisos_cronograma(); $cron$);
