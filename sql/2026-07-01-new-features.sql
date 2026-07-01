-- ═══════════════════════════════════════════════════════════
-- New features: conductor↔vehículo assignment, route tracking,
-- proyecto budget/team linkage
-- ═══════════════════════════════════════════════════════════

-- 1. Assign a conductor to a vehicle (one conductor's primary vehicle)
alter table sgc.conductores
  add column if not exists vehiculo_id uuid references sgc.vehiculos(id);

-- 2. Route / trip tracking (planned vs actual km & time)
create table if not exists sgc.rutas (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references sgc.vehiculos(id),
  conductor_id uuid references sgc.conductores(id),
  origen text not null,
  destino text not null,
  fecha date not null default current_date,
  km_estimado numeric(10,2),
  km_real numeric(10,2),
  tiempo_estimado_min integer,
  tiempo_real_min integer,
  estado text not null default 'planificada', -- planificada | en_curso | completada | cancelada
  notas text,
  creado_por uuid references sgc.usuarios(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table sgc.rutas enable row level security;
create policy "rutas: all" on sgc.rutas for all to authenticated using (true) with check (true);
grant select, insert, update, delete on sgc.rutas to authenticated;

-- 3. Link órdenes de compra to a proyecto for real-spend tracking
alter table sgc.ordenes_compra
  add column if not exists proyecto_id uuid references sgc.proyectos(id);

-- 4. Proyecto ↔ Empleado team assignment
create table if not exists sgc.proyecto_empleados (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references sgc.proyectos(id) on delete cascade,
  empleado_id uuid not null references sgc.empleados(id) on delete cascade,
  rol text,
  created_at timestamptz default now(),
  unique (proyecto_id, empleado_id)
);
alter table sgc.proyecto_empleados enable row level security;
create policy "proyecto_empleados: all" on sgc.proyecto_empleados for all to authenticated using (true) with check (true);
grant select, insert, update, delete on sgc.proyecto_empleados to authenticated;
