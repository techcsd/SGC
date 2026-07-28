-- ============================================================================
-- Z14 — proyecto_estructuras (bloques/pisos por obra)
-- Z15 — cronograma_tareas_catalogo (catálogo global de tareas)
-- PROMPT-6 · FASE 5 · aditivo
-- ============================================================================

-- Z14 — estructuras por obra (texto libre; cada obra nombra distinto) ----------
create table if not exists sgc.proyecto_estructuras (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  nombre      text not null,
  orden       int not null default 1,
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_proyecto_estructuras_proyecto on sgc.proyecto_estructuras (proyecto_id, orden);

alter table sgc.proyecto_estructuras enable row level security;
drop policy if exists "proyecto_estructuras: read" on sgc.proyecto_estructuras;
create policy "proyecto_estructuras: read" on sgc.proyecto_estructuras
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora'));
drop policy if exists "proyecto_estructuras: write" on sgc.proyecto_estructuras;
create policy "proyecto_estructuras: write" on sgc.proyecto_estructuras
  for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
grant select, insert, update, delete on sgc.proyecto_estructuras to authenticated;
grant all on sgc.proyecto_estructuras to service_role;

-- Z15 — catálogo global de tareas de cronograma (admin gestiona) ---------------
create table if not exists sgc.cronograma_tareas_catalogo (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  orden      int not null default 100,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sgc.cronograma_tareas_catalogo enable row level security;
drop policy if exists "cronograma_catalogo: read" on sgc.cronograma_tareas_catalogo;
create policy "cronograma_catalogo: read" on sgc.cronograma_tareas_catalogo
  for select to authenticated using (true);
drop policy if exists "cronograma_catalogo: write admin" on sgc.cronograma_tareas_catalogo;
create policy "cronograma_catalogo: write admin" on sgc.cronograma_tareas_catalogo
  for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
grant select, insert, update, delete on sgc.cronograma_tareas_catalogo to authenticated;
grant all on sgc.cronograma_tareas_catalogo to service_role;

-- Seed inicial (tareas típicas de construcción) --------------------------------
insert into sgc.cronograma_tareas_catalogo (nombre, orden)
select v.nombre, v.orden from (values
  ('Replanteo / trazado', 10),
  ('Excavación', 20),
  ('Fundaciones / zapatas', 30),
  ('Armado de acero', 40),
  ('Encofrado', 50),
  ('Vaciado de hormigón', 60),
  ('Desencofrado', 70),
  ('Mampostería / bloques', 80),
  ('Cantos / dinteles', 90),
  ('Instalaciones eléctricas', 100),
  ('Instalaciones sanitarias', 110),
  ('Fraguache', 120),
  ('Pañete / repello', 130),
  ('Empañetado fino', 140),
  ('Impermeabilización', 150),
  ('Colocación de pisos', 160),
  ('Revestimiento / cerámica', 170),
  ('Carpintería (puertas/ventanas)', 180),
  ('Pintura', 190),
  ('Limpieza final / entrega', 200)
) as v(nombre, orden)
where not exists (select 1 from sgc.cronograma_tareas_catalogo c where c.nombre = v.nombre);
