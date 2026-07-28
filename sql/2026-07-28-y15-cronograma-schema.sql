-- ============================================================================
-- Y15 — Cronograma de Proyectos · FASE 1 (esquema)
-- Ronda 28/07/2026 · PROMPT-3 · aprobado (docs/cronograma-diseno.md)
-- ============================================================================
-- Aditivo y retrocompatible. Fases actuales (fases_proyecto) NO se tocan; el
-- cronograma agrupa tareas por fase (fase = contenedor opcional).
-- ============================================================================

-- 1) Tareas del cronograma ----------------------------------------------------
create table if not exists sgc.cronograma_tareas (
  id                    uuid primary key default gen_random_uuid(),
  proyecto_id           uuid not null references sgc.proyectos(id) on delete cascade,
  fase_id               uuid references sgc.fases_proyecto(id) on delete set null,
  nombre                text not null,
  descripcion           text,
  tipo                  text not null default 'ordinaria'
                          check (tipo in ('ordinaria','importante','critica')),
  orden                 int not null default 1,
  duracion_dias_plan    int not null default 1 check (duracion_dias_plan >= 1),
  fecha_inicio_plan     date,
  fecha_fin_plan        date,
  fecha_inicio_real     date,
  fecha_fin_real        date,
  estado                text not null default 'pendiente'
                          check (estado in ('pendiente','en_curso','completada')),
  justificacion_retraso text,
  foto_evidencia_path   text,
  iniciada_por          uuid references sgc.usuarios(id) on delete set null,
  completada_por        uuid references sgc.usuarios(id) on delete set null,
  es_prueba             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table sgc.cronograma_tareas is
  'Y15 — tareas del cronograma de un proyecto (secuencia lineal por orden). "atrasada" es condición derivada: estado<>completada AND current_date>fecha_fin_plan.';

create index if not exists idx_cronograma_tareas_proyecto on sgc.cronograma_tareas (proyecto_id, orden);
create index if not exists idx_cronograma_tareas_estado on sgc.cronograma_tareas (estado);
create index if not exists idx_cronograma_tareas_fin_plan on sgc.cronograma_tareas (fecha_fin_plan);

-- 2) Historial de recálculos (auditable) --------------------------------------
create table if not exists sgc.cronograma_recalculos (
  id                uuid primary key default gen_random_uuid(),
  proyecto_id       uuid not null references sgc.proyectos(id) on delete cascade,
  tarea_origen_id   uuid references sgc.cronograma_tareas(id) on delete set null,
  tarea_destino_id  uuid references sgc.cronograma_tareas(id) on delete set null,
  dias_movidos      int not null,
  motivo            text not null
                      check (motivo in ('adelanto_dona_critica','holgura_general','retraso_empuje')),
  detalle           jsonb not null default '{}'::jsonb,
  creado_por        uuid references sgc.usuarios(id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table sgc.cronograma_recalculos is
  'Y15 — historial de auto-ajustes del timeline: qué tarea liberó/consumió días, cuál los recibió, cuándo.';

create index if not exists idx_cronograma_recalculos_proyecto on sgc.cronograma_recalculos (proyecto_id, created_at desc);

-- 3) Enlace tarea ↔ bitácora (evidencia, M:N) ---------------------------------
create table if not exists sgc.cronograma_tarea_bitacoras (
  id          uuid primary key default gen_random_uuid(),
  tarea_id    uuid not null references sgc.cronograma_tareas(id) on delete cascade,
  bitacora_id uuid not null references sgc.bitacoras(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (tarea_id, bitacora_id)
);

comment on table sgc.cronograma_tarea_bitacoras is
  'Y15 — enlace bitácora↔tarea de cronograma (evidencia). Una bitácora puede avanzar/completar una tarea.';

-- 4) Avisos: reutilizar sgc.avisos_proyecto (ampliar checks) -------------------
-- tipo: agregar los 3 de cronograma. estado: agregar resuelto_auto (auto-resolución).
-- La tarea se referencia en avisos_proyecto.referencia_id (soft-link, patrón flota).
alter table sgc.avisos_proyecto drop constraint if exists avisos_proyecto_tipo_chk;
alter table sgc.avisos_proyecto add constraint avisos_proyecto_tipo_chk
  check (tipo in ('pago_mayor_trabajo','cronograma_por_iniciar','cronograma_por_vencer','cronograma_atrasada'));

alter table sgc.avisos_proyecto drop constraint if exists avisos_proyecto_estado_chk;
alter table sgc.avisos_proyecto add constraint avisos_proyecto_estado_chk
  check (estado in ('pendiente','atendido','resuelto_auto'));

-- columnas de auto-resolución (paridad con avisos_flota), aditivas
alter table sgc.avisos_proyecto add column if not exists resuelto_at timestamptz;
alter table sgc.avisos_proyecto add column if not exists resuelto_nota text;
alter table sgc.avisos_proyecto add column if not exists email_enviado_at timestamptz;

-- índice de dedup (si no existe) para el upsert del sweep
create unique index if not exists uq_avisos_proyecto_dedup
  on sgc.avisos_proyecto (dedup_key) where dedup_key is not null;

-- 5) RLS ----------------------------------------------------------------------
alter table sgc.cronograma_tareas enable row level security;
alter table sgc.cronograma_recalculos enable row level security;
alter table sgc.cronograma_tarea_bitacoras enable row level security;

-- Helper de permiso: admin OR módulo proyectos OR responsable activo del proyecto.
create or replace function sgc.puede_gestionar_cronograma(p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos')
      or exists (
        select 1 from sgc.proyecto_responsables pr
        where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo
      );
$$;
grant execute on function sgc.puede_gestionar_cronograma(uuid) to authenticated, service_role;

-- Helper de visibilidad de lectura: mismo scope que proyectos.
create or replace function sgc.puede_ver_cronograma(p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = sgc, public
as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables pr where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo)
      or exists (
        select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid()
      );
$$;
grant execute on function sgc.puede_ver_cronograma(uuid) to authenticated, service_role;

-- cronograma_tareas
drop policy if exists "cronograma_tareas: select" on sgc.cronograma_tareas;
create policy "cronograma_tareas: select" on sgc.cronograma_tareas
  for select to authenticated
  using (sgc.puede_ver_cronograma(proyecto_id) and ((not es_prueba) or sgc.is_admin()));

drop policy if exists "cronograma_tareas: write" on sgc.cronograma_tareas;
create policy "cronograma_tareas: write" on sgc.cronograma_tareas
  for all to authenticated
  using (sgc.puede_gestionar_cronograma(proyecto_id))
  with check (sgc.puede_gestionar_cronograma(proyecto_id));

-- cronograma_recalculos (solo lectura para usuarios; escribe el RPC definer)
drop policy if exists "cronograma_recalculos: select" on sgc.cronograma_recalculos;
create policy "cronograma_recalculos: select" on sgc.cronograma_recalculos
  for select to authenticated
  using (sgc.puede_ver_cronograma(proyecto_id));

-- cronograma_tarea_bitacoras
drop policy if exists "cronograma_tarea_bitacoras: select" on sgc.cronograma_tarea_bitacoras;
create policy "cronograma_tarea_bitacoras: select" on sgc.cronograma_tarea_bitacoras
  for select to authenticated
  using (exists (select 1 from sgc.cronograma_tareas t where t.id = tarea_id and sgc.puede_ver_cronograma(t.proyecto_id)));

drop policy if exists "cronograma_tarea_bitacoras: write" on sgc.cronograma_tarea_bitacoras;
create policy "cronograma_tarea_bitacoras: write" on sgc.cronograma_tarea_bitacoras
  for all to authenticated
  using (exists (select 1 from sgc.cronograma_tareas t where t.id = tarea_id and sgc.puede_gestionar_cronograma(t.proyecto_id)))
  with check (exists (select 1 from sgc.cronograma_tareas t where t.id = tarea_id and sgc.puede_gestionar_cronograma(t.proyecto_id)));

-- 6) Grants (gotcha recurrente) ------------------------------------------------
grant select, insert, update, delete on sgc.cronograma_tareas to authenticated;
grant select on sgc.cronograma_recalculos to authenticated;
grant select, insert, delete on sgc.cronograma_tarea_bitacoras to authenticated;
grant all on sgc.cronograma_tareas, sgc.cronograma_recalculos, sgc.cronograma_tarea_bitacoras to service_role;
