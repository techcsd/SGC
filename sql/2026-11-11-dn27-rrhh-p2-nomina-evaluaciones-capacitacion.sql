-- DN-27 P2 (ronda DN, PROMPT-142) — Nómina y pagos, Evaluaciones, Capacitación.
-- Esquema + RLS listos en dev; SIN UI esta ronda (tiempo no alcanzó para las
-- 3 pantallas con la misma calidad que P1) — ver docs/RRHH-ADMIN.md §5.
-- Nómina y Evaluaciones son SENSIBLES (puede_rrhh_sensible, sin bypass de
-- admin). Capacitación no (certificaciones de seguridad, no es dato de
-- compensación/desempeño) — permiso estándar.
begin;

-- ════════════════════════════════════════════════════════════════════════
-- Nómina — SOLO cálculo asistido + exportación. NUNCA mueve dinero. Las
-- fórmulas (TSS/AFP/SFS/ISR) son parámetros editables, marcados para validar
-- con el contador antes de usarse en un período real.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists sgc.rrhh_nomina_parametros (
  clave text primary key,
  valor numeric not null,
  descripcion text,
  validado_por_contador boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table sgc.rrhh_nomina_parametros is
  'DN-27 P2 — porcentajes/topes TSS/AFP/SFS/ISR. validado_por_contador=false hasta que el contador los confirme.';
alter table sgc.rrhh_nomina_parametros enable row level security;
drop policy if exists rrhh_nomina_parametros_sel on sgc.rrhh_nomina_parametros;
create policy rrhh_nomina_parametros_sel on sgc.rrhh_nomina_parametros for select using (sgc.puede_rrhh_sensible('rrhh.nomina'));
drop policy if exists rrhh_nomina_parametros_upd on sgc.rrhh_nomina_parametros;
create policy rrhh_nomina_parametros_upd on sgc.rrhh_nomina_parametros for update using (sgc.puede_operar_rrhh_sensible('rrhh.nomina')) with check (sgc.puede_operar_rrhh_sensible('rrhh.nomina'));
grant select, update on sgc.rrhh_nomina_parametros to authenticated;

insert into sgc.rrhh_nomina_parametros (clave, valor, descripcion) values
  ('tss_empleado_pct', 2.87, 'TSS (SFS) aporte del empleado, % del salario cotizable -- VALIDAR CON CONTADOR'),
  ('afp_empleado_pct', 2.87, 'AFP aporte del empleado, % del salario cotizable -- VALIDAR CON CONTADOR'),
  ('isr_tramo_exento_mensual', 34685, 'ISR -- tramo exento mensual (RD$) -- VALIDAR CON CONTADOR, cambia cada año')
on conflict (clave) do nothing;

create table if not exists sgc.rrhh_nomina_periodos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha_desde date not null,
  fecha_hasta date not null,
  estado text not null default 'borrador' check (estado in ('borrador','calculado','exportado')),
  creado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_nomina_periodos enable row level security;
drop policy if exists rrhh_nomina_periodos_sel on sgc.rrhh_nomina_periodos;
create policy rrhh_nomina_periodos_sel on sgc.rrhh_nomina_periodos for select using (sgc.puede_rrhh_sensible('rrhh.nomina'));
drop policy if exists rrhh_nomina_periodos_ins on sgc.rrhh_nomina_periodos;
create policy rrhh_nomina_periodos_ins on sgc.rrhh_nomina_periodos for insert with check (sgc.puede_operar_rrhh_sensible('rrhh.nomina'));
grant select, insert on sgc.rrhh_nomina_periodos to authenticated;

create table if not exists sgc.rrhh_nomina_detalle (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references sgc.rrhh_nomina_periodos(id) on delete cascade,
  empleado_id uuid not null references sgc.empleados(id),
  salario_bruto numeric not null,
  descuento_tss numeric not null default 0,
  descuento_afp numeric not null default 0,
  descuento_isr numeric not null default 0,
  salario_neto numeric not null,
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_nomina_detalle enable row level security;
drop policy if exists rrhh_nomina_detalle_sel on sgc.rrhh_nomina_detalle;
create policy rrhh_nomina_detalle_sel on sgc.rrhh_nomina_detalle for select using (sgc.puede_rrhh_sensible('rrhh.nomina'));
drop policy if exists rrhh_nomina_detalle_ins on sgc.rrhh_nomina_detalle;
create policy rrhh_nomina_detalle_ins on sgc.rrhh_nomina_detalle for insert with check (sgc.puede_operar_rrhh_sensible('rrhh.nomina'));
grant select, insert on sgc.rrhh_nomina_detalle to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Evaluaciones de desempeño — SENSIBLE.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists sgc.rrhh_evaluaciones (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references sgc.empleados(id),
  evaluador_id uuid references sgc.usuarios(id),
  periodo text not null,
  puntaje numeric,
  comentarios text,
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_evaluaciones enable row level security;
drop policy if exists rrhh_evaluaciones_sel on sgc.rrhh_evaluaciones;
create policy rrhh_evaluaciones_sel on sgc.rrhh_evaluaciones for select using (sgc.puede_rrhh_sensible('rrhh.evaluaciones'));
drop policy if exists rrhh_evaluaciones_ins on sgc.rrhh_evaluaciones;
create policy rrhh_evaluaciones_ins on sgc.rrhh_evaluaciones for insert with check (sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'));
drop policy if exists rrhh_evaluaciones_upd on sgc.rrhh_evaluaciones;
create policy rrhh_evaluaciones_upd on sgc.rrhh_evaluaciones for update using (sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones')) with check (sgc.puede_operar_rrhh_sensible('rrhh.evaluaciones'));
grant select, insert, update on sgc.rrhh_evaluaciones to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Capacitación — NO sensible (permiso estándar, igual que Organigrama).
-- ════════════════════════════════════════════════════════════════════════
create table if not exists sgc.rrhh_capacitaciones (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references sgc.empleados(id),
  curso text not null,
  institucion text,
  fecha_obtencion date,
  fecha_vencimiento date,
  archivo_path text,
  created_at timestamptz not null default now()
);
create index if not exists rrhh_capacitaciones_vencimiento on sgc.rrhh_capacitaciones (fecha_vencimiento) where fecha_vencimiento is not null;
alter table sgc.rrhh_capacitaciones enable row level security;
drop policy if exists rrhh_capacitaciones_sel on sgc.rrhh_capacitaciones;
create policy rrhh_capacitaciones_sel on sgc.rrhh_capacitaciones for select using (sgc.puede_ver_submodulo('rrhh.capacitacion'));
drop policy if exists rrhh_capacitaciones_ins on sgc.rrhh_capacitaciones;
create policy rrhh_capacitaciones_ins on sgc.rrhh_capacitaciones for insert with check (sgc.puede_operar_submodulo('rrhh.capacitacion'));
drop policy if exists rrhh_capacitaciones_upd on sgc.rrhh_capacitaciones;
create policy rrhh_capacitaciones_upd on sgc.rrhh_capacitaciones for update using (sgc.puede_operar_submodulo('rrhh.capacitacion')) with check (sgc.puede_operar_submodulo('rrhh.capacitacion'));
grant select, insert, update on sgc.rrhh_capacitaciones to authenticated;

commit;
