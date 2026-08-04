-- AF39 — Módulo "Tareas" en la app. La app (choferes) no puede unir sgc.usuarios
-- (RLS admin-only) ni sgc.proyectos (RLS sin módulo inventario/flota), así que se
-- expone un RPC security-definer que devuelve LAS TAREAS DEL USUARIO (asignadas a
-- él o creadas por él) con los nombres ya resueltos. Aditivo; las transiciones de
-- estado siguen usando iniciar_tarea / completar_tarea existentes.

create or replace function sgc.mis_tareas_app(p_incluir_completadas boolean default false)
returns table (
  id                 uuid,
  titulo             text,
  descripcion        text,
  estado             text,
  prioridad          text,
  asignado_a         uuid,
  asignado_a_nombre  text,
  asignado_por       uuid,
  asignado_por_nombre text,
  proyecto_id        uuid,
  proyecto_nombre    text,
  fecha_limite       date,
  fecha_completada   date,
  created_at         timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select t.id, t.titulo, t.descripcion, t.estado, t.prioridad,
         t.asignado_a, ua.nombre, t.asignado_por, up.nombre,
         t.proyecto_id, p.nombre, t.fecha_limite, t.fecha_completada, t.created_at
  from sgc.tareas t
  left join sgc.usuarios ua on ua.id = t.asignado_a
  left join sgc.usuarios up on up.id = t.asignado_por
  left join sgc.proyectos p on p.id = t.proyecto_id
  where (
      t.asignado_a = auth.uid()
      or t.asignado_por = auth.uid()
      or sgc.is_admin()
      or sgc.tiene_modulo('tareas')
    )
    and (p_incluir_completadas or t.estado not in ('completada', 'cancelada'))
  order by
    case t.estado when 'en_progreso' then 0 when 'pendiente' then 1 else 2 end,
    case t.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
    t.fecha_limite nulls last,
    t.created_at desc;
$$;
grant execute on function sgc.mis_tareas_app(boolean) to authenticated, service_role;
