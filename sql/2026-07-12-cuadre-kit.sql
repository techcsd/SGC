-- ============================================================================
-- A3 + A3.1 — Cuadre inicial por fases (25/50/75/100) + Kit de inicio de obra
-- reunión 07/07/2026. Fuente del kit: Excel "MATERIALES Y EQUIPOS PARA INICIO
-- DE OBRA (ALMACÉN Y OFICINA)". Base del control antifraude (A4).
-- ============================================================================
set search_path = sgc, public;

-- 1) Plantilla estándar del Kit de inicio (catálogo global) ------------------
create table if not exists sgc.kit_inicio_plantilla (
  id           uuid primary key default gen_random_uuid(),
  categoria    text not null,          -- 'almacen' | 'oficina' | 'cocina_bano'
  referencia   text not null,
  unidad       text not null default 'unidad',
  cantidad     numeric not null default 1,
  prorrateado  boolean not null default false,
  es_min_stock boolean not null default false,  -- forma parte del stock mínimo del almacén de obra
  orden        int not null default 0,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (categoria, referencia)
);

-- 2) Cuadre por proyecto (cabecera) -----------------------------------------
create table if not exists sgc.cuadre_obra (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid not null unique references sgc.proyectos(id) on delete cascade,
  bodega_id    uuid references sgc.bodegas(id),   -- almacén de obra (para stock mínimo / chequeo A5)
  fase_activa  int  not null default 1,           -- 1..4 (25/50/75/100)
  estado       text not null default 'borrador',  -- borrador | aprobado
  aprobado_por uuid references sgc.usuarios(id),
  aprobado_en  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cuadre_obra_fase_chk check (fase_activa between 1 and 4)
);

-- 3) Renglones del cuadre (kit + materiales estimados) ----------------------
create table if not exists sgc.cuadre_items (
  id            uuid primary key default gen_random_uuid(),
  proyecto_id   uuid not null references sgc.proyectos(id) on delete cascade,
  articulo_id   uuid references sgc.articulos(id),   -- si mapea a catálogo, cuenta para el control
  descripcion   text not null,
  unidad        text,
  categoria     text not null default 'material',    -- almacen|oficina|cocina_bano|material
  es_kit        boolean not null default false,
  prorrateado   boolean not null default false,
  es_min_stock  boolean not null default false,
  cantidad_total numeric not null default 0,
  est_f1        numeric not null default 0,
  est_f2        numeric not null default 0,
  est_f3        numeric not null default 0,
  est_f4        numeric not null default 0,
  factor_base   numeric,   -- método CEPOS: cantidad base…
  factor        numeric,   -- …× factor → estimada
  orden         int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cuadre_items_proyecto on sgc.cuadre_items(proyecto_id);
create index if not exists idx_cuadre_items_articulo on sgc.cuadre_items(proyecto_id, articulo_id);

-- 4) Ledger de consumo real contra el cuadre (por fase) ---------------------
create table if not exists sgc.cuadre_consumo (
  id            uuid primary key default gen_random_uuid(),
  proyecto_id   uuid not null references sgc.proyectos(id) on delete cascade,
  articulo_id   uuid not null references sgc.articulos(id),
  fase          int  not null,
  cantidad      numeric not null,
  requisicion_id uuid references sgc.solicitudes_material(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_cuadre_consumo_key on sgc.cuadre_consumo(proyecto_id, articulo_id, fase);

-- 5) RLS ---------------------------------------------------------------------
-- El cuadre, los límites y el consumo son SENSIBLES: nunca para roles de obra.
-- Solo proyectos/compras/dirección/admin (los roles de oficina). El ingeniero
-- (bitácora) NO tiene estos módulos, por lo que no puede leer nada de esto.
alter table sgc.kit_inicio_plantilla enable row level security;
alter table sgc.cuadre_obra          enable row level security;
alter table sgc.cuadre_items         enable row level security;
alter table sgc.cuadre_consumo       enable row level security;

drop policy if exists kit_sel on sgc.kit_inicio_plantilla;
create policy kit_sel on sgc.kit_inicio_plantilla for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario'));
drop policy if exists kit_write on sgc.kit_inicio_plantilla;
create policy kit_write on sgc.kit_inicio_plantilla for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));

-- cuadre_obra / cuadre_items: gestión por proyectos/compras/dirección/admin.
drop policy if exists cuadre_obra_all on sgc.cuadre_obra;
create policy cuadre_obra_all on sgc.cuadre_obra for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'));

drop policy if exists cuadre_items_all on sgc.cuadre_items;
create policy cuadre_items_all on sgc.cuadre_items for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('compras') or sgc.tiene_modulo('direccion'));

-- cuadre_consumo: solo lectura para oficina; lo escribe la RPC (security definer).
drop policy if exists cuadre_consumo_sel on sgc.cuadre_consumo;
create policy cuadre_consumo_sel on sgc.cuadre_consumo for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion'));

-- 6) Grants ------------------------------------------------------------------
grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.kit_inicio_plantilla to authenticated;
grant select, insert, update, delete on sgc.cuadre_obra, sgc.cuadre_items to authenticated;
grant select on sgc.cuadre_consumo to authenticated;
grant all on sgc.kit_inicio_plantilla, sgc.cuadre_obra, sgc.cuadre_items, sgc.cuadre_consumo to service_role;
