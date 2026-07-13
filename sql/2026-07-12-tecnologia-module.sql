-- ============================================================================
-- A7 — Módulo Tecnología — reunión 07/07/2026
-- Homologación de herramientas (informativa para todos), matriz puesto×herramienta,
-- inventario tecnológico (tabla dedicada), y compras tecnológicas (vía solicitudes_compra).
-- Módulo de permisos: tecnologia.
-- ============================================================================

set search_path = sgc, public;

-- 1) Homologación de herramientas oficiales ---------------------------------
create table if not exists sgc.tec_herramientas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  -- nube | ia | notas | reuniones | comunicacion | diseno | gestion | desarrollo | otro
  categoria   text not null default 'otro',
  para_que    text,           -- para qué se usa
  quien_usa   text,           -- quién la usa
  url         text,
  activo      boolean not null default true,
  orden       int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2) Matriz puesto × herramienta --------------------------------------------
create table if not exists sgc.tec_matriz (
  id            uuid primary key default gen_random_uuid(),
  puesto        text not null,
  herramienta_id uuid not null references sgc.tec_herramientas(id) on delete cascade,
  obligatorio   boolean not null default true,
  notas         text,
  created_at    timestamptz not null default now(),
  unique (puesto, herramienta_id)
);

-- 3) Inventario tecnológico (tabla dedicada — asignación a empleado + historial) --
create table if not exists sgc.tec_equipos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text unique,
  nombre       text not null,
  -- laptop | desktop | monitor | telefono | tablet | camara | impresora | red | accesorio | otro
  tipo         text not null default 'otro',
  marca        text,
  modelo       text,
  serie        text,
  -- activo | en_reparacion | en_stock | dado_de_baja
  estado       text not null default 'en_stock',
  empleado_id  uuid references sgc.empleados(id),
  asignado_en  date,
  ubicacion    text,
  notas        text,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint tec_equipos_estado_chk check (estado in ('activo','en_reparacion','en_stock','dado_de_baja'))
);

create table if not exists sgc.tec_equipo_historial (
  id           uuid primary key default gen_random_uuid(),
  equipo_id    uuid not null references sgc.tec_equipos(id) on delete cascade,
  -- asignacion | estado | ubicacion | baja | nota
  tipo_cambio  text not null,
  descripcion  text,
  empleado_id  uuid references sgc.empleados(id),
  usuario_id   uuid references sgc.usuarios(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_tec_matriz_puesto on sgc.tec_matriz(puesto);
create index if not exists idx_tec_equipos_empleado on sgc.tec_equipos(empleado_id);
create index if not exists idx_tec_equipo_hist_equipo on sgc.tec_equipo_historial(equipo_id);

-- 4) Compras tecnológicas: categoriza la solicitud de compra ----------------
alter table sgc.solicitudes_compra
  add column if not exists categoria text;
comment on column sgc.solicitudes_compra.categoria is
  'A7: categoría de la compra (p.ej. "tecnologia"). Null = compra general de obra.';

-- 5) RLS ----------------------------------------------------------------------
alter table sgc.tec_herramientas     enable row level security;
alter table sgc.tec_matriz           enable row level security;
alter table sgc.tec_equipos          enable row level security;
alter table sgc.tec_equipo_historial enable row level security;

-- Homologación + matriz: LECTURA para todo autenticado (informativa);
-- escritura solo tecnologia/admin.
drop policy if exists tec_herr_sel on sgc.tec_herramientas;
create policy tec_herr_sel on sgc.tec_herramientas for select to authenticated using (true);
drop policy if exists tec_herr_write on sgc.tec_herramientas;
create policy tec_herr_write on sgc.tec_herramientas for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));

drop policy if exists tec_matriz_sel on sgc.tec_matriz;
create policy tec_matriz_sel on sgc.tec_matriz for select to authenticated using (true);
drop policy if exists tec_matriz_write on sgc.tec_matriz;
create policy tec_matriz_write on sgc.tec_matriz for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));

-- Inventario tech + historial: solo tecnologia/admin.
drop policy if exists tec_equipos_all on sgc.tec_equipos;
create policy tec_equipos_all on sgc.tec_equipos for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));

drop policy if exists tec_hist_all on sgc.tec_equipo_historial;
create policy tec_hist_all on sgc.tec_equipo_historial for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia'));

-- 6) Grants -------------------------------------------------------------------
grant usage on schema sgc to authenticated;
grant select on sgc.tec_herramientas, sgc.tec_matriz to authenticated;
grant insert, update, delete on sgc.tec_herramientas, sgc.tec_matriz to authenticated;
grant select, insert, update, delete on sgc.tec_equipos, sgc.tec_equipo_historial to authenticated;
grant all on sgc.tec_herramientas, sgc.tec_matriz, sgc.tec_equipos, sgc.tec_equipo_historial to service_role;

-- 7) Añadir módulo 'tecnologia' al rol admin (gotcha recurrente) -------------
update sgc.roles
   set modulos = array_append(modulos, 'tecnologia')
 where codigo = 'admin' and not ('tecnologia' = any(modulos));

-- 8) Seed de homologación (herramientas oficiales acordadas) -----------------
insert into sgc.tec_herramientas (nombre, categoria, para_que, quien_usa, url, orden)
select * from (values
  ('Google Drive', 'nube', 'Almacenamiento y documentación en la nube de la empresa', 'Todo el personal', 'https://drive.google.com', 1),
  ('Claude', 'ia', 'Asistente de IA (redacción, análisis, resúmenes)', 'Todo el personal', 'https://claude.ai', 2),
  ('Fireflies', 'notas', 'Notas y transcripción automática de reuniones', 'Gerencia y administración', 'https://fireflies.ai', 3),
  ('Google Meet', 'reuniones', 'Reuniones por video (herramienta oficial — no Teams)', 'Todo el personal', 'https://meet.google.com', 4)
) as v(nombre, categoria, para_que, quien_usa, url, orden)
where not exists (select 1 from sgc.tec_herramientas t where t.nombre = v.nombre);
