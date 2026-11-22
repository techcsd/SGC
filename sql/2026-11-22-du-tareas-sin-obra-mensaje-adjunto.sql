-- 2026-11-22 -- PROMPT-151 DU (hotfix):
-- A) Tareas: la obra NO es obligatoria. La web ya la tenia opcional ("Proyecto (opcional)"), pero la herramienta
--    proponer_tarea (conector Claude / Compa) usaba asignar_tarea_obra (exige obra y el permiso obra.plan_dia).
--    sgc.asignar_tarea: misma regla que la politica "tareas: insert" (admin o modulo tareas), obra opcional.
-- B) Mensajes directos con adjunto desde el conector: sgc.enviar_mensaje_directo_adjunto (NOMBRE NUEVO a proposito:
--    no se crea otra sobrecarga de enviar_mensaje_directo). El bucket sgc-mensajes admite tambien csv y txt.
-- Aditiva.
begin;
set local lock_timeout = '3s';

-- ── A) asignar_tarea ────────────────────────────────────────────────────────────
create or replace function sgc.asignar_tarea(
  p_titulo text,
  p_descripcion text default null,
  p_asignado_a uuid default null,
  p_prioridad text default 'media',
  p_fecha_limite date default null,
  p_proyecto_id uuid default null
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $fn$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    raise exception 'Sesión requerida.' using errcode = '42501';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('tareas')) then
    raise exception 'No tienes permiso para asignar tareas.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_titulo), '') = '' then
    raise exception 'La tarea necesita un título.' using errcode = '22023';
  end if;
  if p_asignado_a is null then
    raise exception 'Indica a quién se asigna la tarea.' using errcode = '22023';
  end if;
  if not exists (select 1 from sgc.usuarios where id = p_asignado_a) then
    raise exception 'El usuario asignado no existe.' using errcode = '22023';
  end if;
  if p_prioridad is not null and p_prioridad not in ('alta', 'media', 'baja') then
    raise exception 'La prioridad debe ser alta, media o baja.' using errcode = '22023';
  end if;
  if p_proyecto_id is not null and not exists (select 1 from sgc.proyectos where id = p_proyecto_id) then
    raise exception 'La obra indicada no existe.' using errcode = '22023';
  end if;

  insert into sgc.tareas (id, titulo, descripcion, estado, prioridad, asignado_a, asignado_por, proyecto_id, fecha_limite)
  values (v_id, btrim(p_titulo), nullif(btrim(coalesce(p_descripcion, '')), ''), 'pendiente',
          coalesce(p_prioridad, 'media'), p_asignado_a, v_uid, p_proyecto_id, p_fecha_limite);

  begin
    if p_asignado_a <> v_uid then
      perform sgc.notificar(p_asignado_a, 'tarea', 'Nueva tarea', btrim(p_titulo), '/tareas');
    end if;
  exception when others then null;
  end;
  return v_id;
end $fn$;
revoke all on function sgc.asignar_tarea(text, text, uuid, text, date, uuid) from public, anon;
grant execute on function sgc.asignar_tarea(text, text, uuid, text, date, uuid) to authenticated, service_role;

-- ── B) mensaje directo con adjunto ───────────────────────────────────────────────
update storage.buckets
   set allowed_mime_types = (select array_agg(distinct m) from unnest(allowed_mime_types || array['text/csv', 'text/plain']) m)
 where id = 'sgc-mensajes' and not (allowed_mime_types @> array['text/csv', 'text/plain']);

create or replace function sgc.enviar_mensaje_directo_adjunto(
  p_destinatario_usuario_id uuid,
  p_contenido text,
  p_archivo_path text,
  p_archivo_nombre text,
  p_archivo_mime text,
  p_archivo_size bigint default null
) returns sgc.mensajes
language plpgsql security invoker set search_path to 'sgc', 'pg_temp' as $fn$
declare
  v_conv_id uuid;
  v_row sgc.mensajes;
begin
  if coalesce(btrim(p_archivo_path), '') = '' or coalesce(btrim(p_archivo_nombre), '') = '' then
    raise exception 'Falta el archivo adjunto.' using errcode = '22023';
  end if;
  v_conv_id := sgc.crear_conversacion_directa(p_destinatario_usuario_id);
  -- El archivo debe vivir en la carpeta de ESTA conversación (así lo ven los participantes y nadie más).
  if split_part(p_archivo_path, '/', 1) <> v_conv_id::text then
    raise exception 'El archivo no pertenece a esta conversación.' using errcode = '22023';
  end if;
  insert into sgc.mensajes (conversacion_id, autor_id, contenido, archivo_path, archivo_nombre, archivo_mime, archivo_size)
  values (v_conv_id, auth.uid(), nullif(btrim(coalesce(p_contenido, '')), ''), p_archivo_path, p_archivo_nombre, p_archivo_mime, p_archivo_size)
  returning * into v_row;
  return v_row;
end $fn$;
revoke all on function sgc.enviar_mensaje_directo_adjunto(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function sgc.enviar_mensaje_directo_adjunto(uuid, text, text, text, text, bigint) to authenticated;

commit;
