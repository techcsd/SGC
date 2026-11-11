-- DN-29 (ronda DN, PROMPT-142) — Administración de la empresa: Trámites y
-- cumplimiento (prioridad 2, con UI esta ronda), Proveedores administrativos
-- y Activos de oficina (prioridad 3/4 — esquema + RLS listos en dev, UI
-- pendiente). Gastos (prioridad 1) NO se duplica: reusa /compras/gastos
-- (ver compras.routes.ts + shell.ts, cambio de código, no de esquema).
-- Permiso ESTÁNDAR (nivel_submodulo, con el bypass de admin/módulo-padre) —
-- a diferencia de RRHH-Personas sensible, esto es logística de oficina, no
-- datos personales del empleado.
begin;

create table if not exists sgc.rrhh_tramites (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('permiso','licencia','seguro','impuesto','otro')),
  entidad_responsable text,
  numero_referencia text,
  fecha_emision date,
  fecha_vencimiento date,
  archivo_path text,
  estado text not null default 'vigente' check (estado in ('vigente','vencido','en_tramite')),
  notas text,
  creado_por uuid references sgc.usuarios(id),
  es_prueba boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rrhh_tramites_vencimiento on sgc.rrhh_tramites (fecha_vencimiento) where fecha_vencimiento is not null;
alter table sgc.rrhh_tramites enable row level security;

drop policy if exists rrhh_tramites_sel on sgc.rrhh_tramites;
create policy rrhh_tramites_sel on sgc.rrhh_tramites for select using (sgc.puede_ver_submodulo('rrhh.tramites'));
drop policy if exists rrhh_tramites_ins on sgc.rrhh_tramites;
create policy rrhh_tramites_ins on sgc.rrhh_tramites for insert with check (sgc.puede_operar_submodulo('rrhh.tramites'));
drop policy if exists rrhh_tramites_upd on sgc.rrhh_tramites;
create policy rrhh_tramites_upd on sgc.rrhh_tramites for update using (sgc.puede_operar_submodulo('rrhh.tramites')) with check (sgc.puede_operar_submodulo('rrhh.tramites'));
drop policy if exists rrhh_tramites_del on sgc.rrhh_tramites;
create policy rrhh_tramites_del on sgc.rrhh_tramites for delete using (sgc.puede_operar_submodulo('rrhh.tramites'));
grant select, insert, update, delete on sgc.rrhh_tramites to authenticated;

create or replace function sgc.rrhh_tramites_por_vencer(p_dias int default 30)
returns setof sgc.rrhh_tramites
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select * from sgc.rrhh_tramites
  where sgc.puede_ver_submodulo('rrhh.tramites')
    and fecha_vencimiento is not null
    and fecha_vencimiento <= current_date + make_interval(days => p_dias)
  order by fecha_vencimiento;
$function$;
grant execute on function sgc.rrhh_tramites_por_vencer(int) to authenticated, service_role;

-- ── Proveedores administrativos (DISTINTO de sgc.proveedores de Compras:
-- internet, limpieza, seguros de oficina -- no material/transporte) ──────────
create table if not exists sgc.rrhh_proveedores_admin (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  servicio text,
  contacto_nombre text,
  contacto_telefono text,
  contacto_email text,
  contrato_desde date,
  contrato_hasta date,
  monto_mensual numeric,
  notas text,
  activo boolean not null default true,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_proveedores_admin enable row level security;
drop policy if exists rrhh_proveedores_admin_sel on sgc.rrhh_proveedores_admin;
create policy rrhh_proveedores_admin_sel on sgc.rrhh_proveedores_admin for select using (sgc.puede_ver_submodulo('rrhh.proveedores'));
drop policy if exists rrhh_proveedores_admin_ins on sgc.rrhh_proveedores_admin;
create policy rrhh_proveedores_admin_ins on sgc.rrhh_proveedores_admin for insert with check (sgc.puede_operar_submodulo('rrhh.proveedores'));
drop policy if exists rrhh_proveedores_admin_upd on sgc.rrhh_proveedores_admin;
create policy rrhh_proveedores_admin_upd on sgc.rrhh_proveedores_admin for update using (sgc.puede_operar_submodulo('rrhh.proveedores')) with check (sgc.puede_operar_submodulo('rrhh.proveedores'));
drop policy if exists rrhh_proveedores_admin_del on sgc.rrhh_proveedores_admin;
create policy rrhh_proveedores_admin_del on sgc.rrhh_proveedores_admin for delete using (sgc.puede_operar_submodulo('rrhh.proveedores'));
grant select, insert, update, delete on sgc.rrhh_proveedores_admin to authenticated;

-- ── Activos y oficina (DISTINTO del inventario tecnológico: mobiliario,
-- suministros, mantenimiento del local) ───────────────────────────────────
create table if not exists sgc.rrhh_activos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null check (categoria in ('mobiliario','suministro','equipo_oficina','otro')),
  ubicacion text,
  estado text not null default 'bueno' check (estado in ('bueno','regular','mantenimiento','baja')),
  fecha_adquisicion date,
  valor numeric,
  proximo_mantenimiento date,
  notas text,
  es_prueba boolean not null default false,
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_activos enable row level security;
drop policy if exists rrhh_activos_sel on sgc.rrhh_activos;
create policy rrhh_activos_sel on sgc.rrhh_activos for select using (sgc.puede_ver_submodulo('rrhh.activos'));
drop policy if exists rrhh_activos_ins on sgc.rrhh_activos;
create policy rrhh_activos_ins on sgc.rrhh_activos for insert with check (sgc.puede_operar_submodulo('rrhh.activos'));
drop policy if exists rrhh_activos_upd on sgc.rrhh_activos;
create policy rrhh_activos_upd on sgc.rrhh_activos for update using (sgc.puede_operar_submodulo('rrhh.activos')) with check (sgc.puede_operar_submodulo('rrhh.activos'));
drop policy if exists rrhh_activos_del on sgc.rrhh_activos;
create policy rrhh_activos_del on sgc.rrhh_activos for delete using (sgc.puede_operar_submodulo('rrhh.activos'));
grant select, insert, update, delete on sgc.rrhh_activos to authenticated;

commit;
