-- Tareas module: managers (roles with the 'tareas' module) assign tasks to any
-- user; assignees see and progress their own tasks in "Mis tareas". Task states
-- follow a simple ERP workflow (pendiente → en_progreso → completada, plus
-- cancelada); "vencida" is derived in the UI (fecha_limite past + not done), not
-- stored, so it can never drift out of sync. Optional project link ties a task
-- to an obra. Comments give a lightweight activity trail per task.

-- ═══════════════════════════════════════════════════════════
-- 1. Tareas
-- ═══════════════════════════════════════════════════════════
create table sgc.tareas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  descripcion    text,
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'en_progreso', 'completada', 'cancelada')),
  prioridad      text not null default 'media' check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  asignado_a     uuid not null references sgc.usuarios(id),
  asignado_por   uuid not null references sgc.usuarios(id),
  proyecto_id    uuid references sgc.proyectos(id),
  fecha_limite   date,
  fecha_completada timestamptz,
  created_at     timestamptz not null default now()
);
create index idx_tareas_asignado_a on sgc.tareas(asignado_a);
create index idx_tareas_asignado_por on sgc.tareas(asignado_por);
create index idx_tareas_estado on sgc.tareas(estado);
create index idx_tareas_proyecto on sgc.tareas(proyecto_id);

create table sgc.tarea_comentarios (
  id         uuid primary key default gen_random_uuid(),
  tarea_id   uuid not null references sgc.tareas(id) on delete cascade,
  usuario_id uuid references sgc.usuarios(id),
  comentario text not null,
  created_at timestamptz not null default now()
);
create index idx_tarea_comentarios_tarea on sgc.tarea_comentarios(tarea_id);

alter table sgc.tareas enable row level security;
alter table sgc.tarea_comentarios enable row level security;

-- A "manager" is admin or anyone whose role grants the 'tareas' module. Everyone
-- else can only see/act on tasks where they are the assignee or the assigner.
create policy "tareas: select" on sgc.tareas for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('tareas')
    or asignado_a = auth.uid() or asignado_por = auth.uid()
  );
create policy "tareas: insert" on sgc.tareas for insert to authenticated
  with check ((sgc.is_admin() or sgc.tiene_modulo('tareas')) and asignado_por = auth.uid());
-- Managers/admin can fully edit; the assignee can update their own task (to move
-- it through the workflow). The UI only exposes state changes to assignees.
create policy "tareas: update" on sgc.tareas for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tareas') or asignado_a = auth.uid());
create policy "tareas: delete" on sgc.tareas for delete to authenticated
  using (sgc.is_admin() or (sgc.tiene_modulo('tareas') and asignado_por = auth.uid()));

-- Comments follow the parent task's visibility.
create policy "tarea_comentarios: select" on sgc.tarea_comentarios for select to authenticated
  using (
    exists (
      select 1 from sgc.tareas t
      where t.id = tarea_comentarios.tarea_id
        and (sgc.is_admin() or sgc.tiene_modulo('tareas') or t.asignado_a = auth.uid() or t.asignado_por = auth.uid())
    )
  );
create policy "tarea_comentarios: insert" on sgc.tarea_comentarios for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and exists (
      select 1 from sgc.tareas t
      where t.id = tarea_comentarios.tarea_id
        and (sgc.is_admin() or sgc.tiene_modulo('tareas') or t.asignado_a = auth.uid() or t.asignado_por = auth.uid())
    )
  );
create policy "tarea_comentarios: delete" on sgc.tarea_comentarios for delete to authenticated
  using (sgc.is_admin() or usuario_id = auth.uid());

grant select, insert, update, delete on sgc.tareas to authenticated;
grant select, insert, delete on sgc.tarea_comentarios to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 2. New 'tareas' module → grant to admin immediately (same recurring gotcha:
--    admin's modulos array does not auto-update when a module key is added).
--    Any role that should be able to ASSIGN tasks gets 'tareas' via Admin >
--    Roles; every authenticated user can already see tasks assigned to them.
-- ═══════════════════════════════════════════════════════════
update sgc.roles set modulos = array_append(modulos, 'tareas')
  where codigo = 'admin' and not ('tareas' = any(modulos));
