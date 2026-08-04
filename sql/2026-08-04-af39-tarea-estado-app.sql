-- AF39 (fix QA) — Transiciones de estado para el MÓDULO GENERAL sgc.tareas.
-- OJO: iniciar_tarea/completar_tarea existentes operan sobre sgc.cronograma_tareas
-- (cronograma de proyecto), NO sobre sgc.tareas. La app de Tareas necesita sus
-- propios RPC. Permiso = asignado_a / asignado_por / admin / módulo tareas
-- (mismo criterio que la policy update de sgc.tareas). Aditivo.

create or replace function sgc.iniciar_tarea_app(p_tarea_id uuid)
returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_permit boolean;
begin
  select (asignado_a = auth.uid() or asignado_por = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('tareas'))
    into v_permit from sgc.tareas where id = p_tarea_id;
  if v_permit is null then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if not v_permit then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update sgc.tareas set estado = 'en_progreso'
   where id = p_tarea_id and estado = 'pendiente';  -- idempotente
end;
$$;
grant execute on function sgc.iniciar_tarea_app(uuid) to authenticated, service_role;

create or replace function sgc.completar_tarea_app(
  p_tarea_id uuid, p_justificacion text default null, p_foto_path text default null
) returns void language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_permit boolean;
begin
  select (asignado_a = auth.uid() or asignado_por = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('tareas'))
    into v_permit from sgc.tareas where id = p_tarea_id;
  if v_permit is null then raise exception 'Tarea no encontrada' using errcode = 'P0002'; end if;
  if not v_permit then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update sgc.tareas set estado = 'completada', fecha_completada = current_date
   where id = p_tarea_id and estado <> 'completada';  -- idempotente
  -- Nota de cierre + evidencia como comentario (tarea_comentarios no tiene foto).
  if coalesce(p_justificacion, '') <> '' or coalesce(p_foto_path, '') <> '' then
    insert into sgc.tarea_comentarios (tarea_id, usuario_id, comentario)
    values (
      p_tarea_id, auth.uid(),
      trim(both E'\n' from coalesce(p_justificacion, '') ||
        case when coalesce(p_foto_path, '') <> '' then E'\n[Evidencia] ' || p_foto_path else '' end)
    );
  end if;
end;
$$;
grant execute on function sgc.completar_tarea_app(uuid, text, text) to authenticated, service_role;
