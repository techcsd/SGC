-- DN-27 P1 (ronda DN, PROMPT-142) — Reclutamiento (onboarding): vacantes,
-- candidatos y el pipeline de ingreso. Esquema + RLS listos en dev; SIN UI
-- esta ronda (P1 priorizó Contratos y Organigrama con pantalla completa) —
-- ver docs/RRHH-ADMIN.md §5. Permiso estándar (no está en la lista explícita
-- de sensibles de Xaviel: nómina/evaluaciones/disciplina/expedientes).
begin;

create table if not exists sgc.rrhh_vacantes (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  departamento text,
  descripcion text,
  estado text not null default 'abierta' check (estado in ('abierta','pausada','cerrada')),
  creado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now()
);
alter table sgc.rrhh_vacantes enable row level security;
drop policy if exists rrhh_vacantes_sel on sgc.rrhh_vacantes;
create policy rrhh_vacantes_sel on sgc.rrhh_vacantes for select using (sgc.puede_ver_submodulo('rrhh.onboarding'));
drop policy if exists rrhh_vacantes_ins on sgc.rrhh_vacantes;
create policy rrhh_vacantes_ins on sgc.rrhh_vacantes for insert with check (sgc.puede_operar_submodulo('rrhh.onboarding'));
drop policy if exists rrhh_vacantes_upd on sgc.rrhh_vacantes;
create policy rrhh_vacantes_upd on sgc.rrhh_vacantes for update using (sgc.puede_operar_submodulo('rrhh.onboarding')) with check (sgc.puede_operar_submodulo('rrhh.onboarding'));
grant select, insert, update on sgc.rrhh_vacantes to authenticated;

create table if not exists sgc.rrhh_candidatos (
  id uuid primary key default gen_random_uuid(),
  vacante_id uuid references sgc.rrhh_vacantes(id) on delete cascade,
  nombre text not null,
  telefono text,
  email text,
  cv_path text,
  etapa text not null default 'aplicado'
    check (etapa in ('aplicado','entrevista','oferta','contratado','rechazado')),
  notas text,
  empleado_id uuid references sgc.empleados(id), -- se llena si pasa a 'contratado'
  creado_por uuid references sgc.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rrhh_candidatos_vacante on sgc.rrhh_candidatos(vacante_id);
alter table sgc.rrhh_candidatos enable row level security;
drop policy if exists rrhh_candidatos_sel on sgc.rrhh_candidatos;
create policy rrhh_candidatos_sel on sgc.rrhh_candidatos for select using (sgc.puede_ver_submodulo('rrhh.onboarding'));
drop policy if exists rrhh_candidatos_ins on sgc.rrhh_candidatos;
create policy rrhh_candidatos_ins on sgc.rrhh_candidatos for insert with check (sgc.puede_operar_submodulo('rrhh.onboarding'));
drop policy if exists rrhh_candidatos_upd on sgc.rrhh_candidatos;
create policy rrhh_candidatos_upd on sgc.rrhh_candidatos for update using (sgc.puede_operar_submodulo('rrhh.onboarding')) with check (sgc.puede_operar_submodulo('rrhh.onboarding'));
grant select, insert, update on sgc.rrhh_candidatos to authenticated;

commit;
