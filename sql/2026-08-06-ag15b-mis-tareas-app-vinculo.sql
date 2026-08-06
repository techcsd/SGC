-- AG15 (app) — exponer el vínculo de tarea dinámica en mis_tareas_app.
--
-- El contrato de tareas dinámicas (linked_tipo/linked_id/linked_params/
-- auto_completada + vincular_tarea_entidad + sincronizar_tareas_vinculadas +
-- triggers) ya existe (2026-08-05-ag15-tareas-dinamicas.sql). Faltaba que la app
-- pudiera VER el vínculo: mis_tareas_app no devolvía esos campos, así que el módulo
-- Tareas no podía detectar una tarea vinculada ni leer sus params de pre-llenado.
--
-- Aditivo: se agregan 4 columnas AL FINAL del TABLE. Clientes viejos (que mapean por
-- nombre vía PostgREST) ignoran las columnas nuevas → retrocompatible.

set search_path = sgc, public;

drop function if exists sgc.mis_tareas_app(boolean);

create or replace function sgc.mis_tareas_app(p_incluir_completadas boolean DEFAULT false)
returns table(
  id uuid, titulo text, descripcion text, estado text, prioridad text,
  asignado_a uuid, asignado_a_nombre text, asignado_por uuid, asignado_por_nombre text,
  proyecto_id uuid, proyecto_nombre text, fecha_limite date, fecha_completada date,
  created_at timestamp with time zone,
  -- AG15 — vínculo dinámico (nuevos, al final).
  linked_tipo text, linked_id uuid, linked_params jsonb, auto_completada boolean
)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select t.id, t.titulo, t.descripcion, t.estado, t.prioridad,
         t.asignado_a, ua.nombre, t.asignado_por, up.nombre,
         t.proyecto_id, p.nombre, t.fecha_limite, t.fecha_completada, t.created_at,
         t.linked_tipo, t.linked_id, t.linked_params, t.auto_completada
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
$function$;

grant execute on function sgc.mis_tareas_app(boolean) to authenticated, service_role;
