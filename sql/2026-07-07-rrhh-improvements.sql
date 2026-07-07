-- RRHH upgrade, guided by standard ERP HR modules (employee master data +
-- time/leave + documents). Three additions, all following the existing
-- module-gated RLS pattern (admin or tiene_modulo('rrhh'), plus self-read for
-- the linked usuario where it makes sense):
--   1. Richer employee master record (personal data, org hierarchy, egreso,
--      DR social-security identifiers, vacation entitlement, bank for payroll).
--   2. Leave / absence management (solicitudes_ausencia) with an approval
--      workflow and derived vacation balances.
--   3. Per-employee document store (contract scans, cédula, evaluations…).

-- ═══════════════════════════════════════════════════════════
-- 1. Enrich sgc.empleados (all nullable / defaulted → existing rows stay valid)
-- ═══════════════════════════════════════════════════════════
alter table sgc.empleados
  add column if not exists fecha_nacimiento          date,
  add column if not exists genero                    text check (genero in ('masculino', 'femenino', 'otro')),
  add column if not exists estado_civil              text check (estado_civil in ('soltero', 'casado', 'union_libre', 'divorciado', 'viudo')),
  add column if not exists contacto_emergencia_nombre   text,
  add column if not exists contacto_emergencia_telefono text,
  add column if not exists jefe_id                   uuid references sgc.empleados(id),
  add column if not exists fecha_egreso              date,
  add column if not exists motivo_egreso             text,
  add column if not exists numero_tss                text,   -- Tesorería de la Seguridad Social (DR)
  add column if not exists afp                       text,   -- fondo de pensiones
  add column if not exists ars                       text,   -- seguro de salud
  add column if not exists dias_vacaciones_anuales   integer not null default 14,  -- DR base entitlement
  add column if not exists banco                     text,
  add column if not exists cuenta_banco              text;

-- ═══════════════════════════════════════════════════════════
-- 2. Solicitudes de ausencia (vacaciones / permisos / licencias)
-- ═══════════════════════════════════════════════════════════
create table sgc.solicitudes_ausencia (
  id                  uuid primary key default gen_random_uuid(),
  empleado_id         uuid not null references sgc.empleados(id) on delete cascade,
  tipo                text not null check (tipo in (
                        'vacaciones', 'enfermedad', 'permiso_personal',
                        'licencia_maternidad', 'licencia_paternidad', 'duelo', 'no_remunerada')),
  fecha_inicio        date not null,
  fecha_fin           date not null,
  dias                numeric(5, 1) not null,   -- working days, computed client-side (editable)
  motivo              text,
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por      uuid not null references sgc.usuarios(id),
  aprobado_por        uuid references sgc.usuarios(id),
  comentario_aprobador text,
  fecha_solicitud     timestamptz not null default now(),
  fecha_resolucion    timestamptz,
  constraint solicitudes_ausencia_fechas_ok check (fecha_fin >= fecha_inicio)
);
create index idx_solicitudes_ausencia_empleado on sgc.solicitudes_ausencia(empleado_id);
create index idx_solicitudes_ausencia_estado on sgc.solicitudes_ausencia(estado);

alter table sgc.solicitudes_ausencia enable row level security;

-- HR/admin see all; a user sees requests for their own employee record or ones
-- they filed.
create policy "solicitudes_ausencia: select" on sgc.solicitudes_ausencia for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('rrhh')
    or solicitado_por = auth.uid()
    or exists (select 1 from sgc.empleados e where e.id = empleado_id and e.usuario_id = auth.uid())
  );
create policy "solicitudes_ausencia: insert" on sgc.solicitudes_ausencia for insert to authenticated
  with check (
    solicitado_por = auth.uid()
    and (
      sgc.is_admin() or sgc.tiene_modulo('rrhh')
      or exists (select 1 from sgc.empleados e where e.id = empleado_id and e.usuario_id = auth.uid())
    )
  );
-- Only HR/admin resolve a pending request; the forged-approver / re-decide holes
-- are closed the same way the solicitudes_material policy does it.
create policy "solicitudes_ausencia: update" on sgc.solicitudes_ausencia for update to authenticated
  using ((sgc.is_admin() or sgc.tiene_modulo('rrhh')) and estado = 'pendiente')
  with check (aprobado_por = auth.uid() and estado in ('aprobada', 'rechazada'));
-- Requester can withdraw their own still-pending request; HR/admin can delete.
create policy "solicitudes_ausencia: delete" on sgc.solicitudes_ausencia for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh') or (solicitado_por = auth.uid() and estado = 'pendiente'));

grant select, insert, update, delete on sgc.solicitudes_ausencia to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3. Employee documents (contract scans, cédula, evaluations, warnings…)
-- ═══════════════════════════════════════════════════════════
create table sgc.empleado_documentos (
  id           uuid primary key default gen_random_uuid(),
  empleado_id  uuid not null references sgc.empleados(id) on delete cascade,
  tipo         text not null check (tipo in ('contrato', 'cedula', 'titulo', 'certificacion', 'amonestacion', 'evaluacion', 'otro')),
  nombre       text not null,
  archivo_path text not null,
  tipo_mime    text,
  subido_por   uuid references sgc.usuarios(id),
  created_at   timestamptz not null default now()
);
create index idx_empleado_documentos_empleado on sgc.empleado_documentos(empleado_id);

alter table sgc.empleado_documentos enable row level security;

-- HR/admin only — employee files are sensitive (contracts, warnings).
create policy "empleado_documentos: select" on sgc.empleado_documentos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "empleado_documentos: insert" on sgc.empleado_documentos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "empleado_documentos: delete" on sgc.empleado_documentos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'));

grant select, insert, delete on sgc.empleado_documentos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sgc-rrhh', 'sgc-rrhh', false, 26214400,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword', 'application/pdf', 'image/png', 'image/jpeg'
  ]
)
on conflict (id) do nothing;

create policy "sgc-rrhh: scoped read" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-rrhh' and (sgc.is_admin() or sgc.tiene_modulo('rrhh')));
create policy "sgc-rrhh: scoped upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-rrhh' and (sgc.is_admin() or sgc.tiene_modulo('rrhh')));
create policy "sgc-rrhh: scoped delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sgc-rrhh' and (sgc.is_admin() or sgc.tiene_modulo('rrhh')));
