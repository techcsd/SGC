-- Legal module: expedientes (case tracking), contratos (contract registry
-- with renewal alerts), and a cross-module approval queue so
-- compras/rrhh/proyectos/documentos can route something to Legal for
-- sign-off before it's final. New 'legal' module key + role for the
-- in-house lawyer, following the same module-gated RLS pattern as every
-- other module in this schema.

-- ═══════════════════════════════════════════════════════════
-- 1. Expedientes legales (casos/matters)
-- ═══════════════════════════════════════════════════════════
create sequence sgc.expedientes_legales_codigo_seq;

create table sgc.expedientes_legales (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique default ('EXP-' || lpad(nextval('sgc.expedientes_legales_codigo_seq')::text, 5, '0')),
  titulo         text not null,
  tipo           text not null check (tipo in ('laboral', 'permiso', 'reclamacion', 'litigio', 'cumplimiento', 'contractual', 'otro')),
  estado         text not null default 'abierto' check (estado in ('abierto', 'en_proceso', 'en_espera', 'cerrado')),
  prioridad      text not null default 'media' check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  proyecto_id    uuid references sgc.proyectos(id),
  contraparte    text,
  descripcion    text,
  fecha_apertura date not null default current_date,
  fecha_limite   date,
  fecha_cierre   date,
  responsable_id uuid references sgc.usuarios(id),
  creado_por     uuid references sgc.usuarios(id),
  created_at     timestamptz not null default now()
);
create index idx_expedientes_legales_proyecto on sgc.expedientes_legales(proyecto_id);
create index idx_expedientes_legales_estado on sgc.expedientes_legales(estado);

create table sgc.expediente_notas (
  id            uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references sgc.expedientes_legales(id) on delete cascade,
  usuario_id    uuid references sgc.usuarios(id),
  nota          text not null,
  created_at    timestamptz not null default now()
);
create index idx_expediente_notas_expediente on sgc.expediente_notas(expediente_id);

create table sgc.expediente_archivos (
  id            uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references sgc.expedientes_legales(id) on delete cascade,
  nombre        text not null,
  archivo_path  text not null,
  tipo_mime     text,
  subido_por    uuid references sgc.usuarios(id),
  created_at    timestamptz not null default now()
);
create index idx_expediente_archivos_expediente on sgc.expediente_archivos(expediente_id);

alter table sgc.expedientes_legales enable row level security;
alter table sgc.expediente_notas enable row level security;
alter table sgc.expediente_archivos enable row level security;

create policy "expedientes_legales: select" on sgc.expedientes_legales for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expedientes_legales: insert" on sgc.expedientes_legales for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expedientes_legales: update" on sgc.expedientes_legales for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expedientes_legales: delete" on sgc.expedientes_legales for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));

create policy "expediente_notas: select" on sgc.expediente_notas for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expediente_notas: insert" on sgc.expediente_notas for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expediente_notas: delete" on sgc.expediente_notas for delete to authenticated
  using (sgc.is_admin() or usuario_id = auth.uid());

create policy "expediente_archivos: select" on sgc.expediente_archivos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expediente_archivos: insert" on sgc.expediente_archivos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "expediente_archivos: delete" on sgc.expediente_archivos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));

grant select, insert, update, delete on sgc.expedientes_legales to authenticated;
grant select, insert, delete on sgc.expediente_notas to authenticated;
grant select, insert, delete on sgc.expediente_archivos to authenticated;
grant usage, select on sequence sgc.expedientes_legales_codigo_seq to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 2. Contratos (contract registry) — separate from the generic
--    plantillas_documento/documentos_generados engine. A contrato row
--    tracks the business lifecycle (borrador → revisión → firmado →
--    vencido) and can optionally point at the actual generated document.
-- ═══════════════════════════════════════════════════════════
create sequence sgc.contratos_codigo_seq;

create table sgc.contratos (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null unique default ('CON-' || lpad(nextval('sgc.contratos_codigo_seq')::text, 5, '0')),
  titulo                text not null,
  tipo                  text not null check (tipo in ('subcontrato', 'proveedor', 'laboral', 'arrendamiento', 'servicios', 'otro')),
  contraparte_nombre    text not null,
  proveedor_id          uuid references sgc.proveedores(id),
  proyecto_id           uuid references sgc.proyectos(id),
  documento_generado_id uuid references sgc.documentos_generados(id),
  estado                text not null default 'borrador' check (estado in ('borrador', 'en_revision', 'firmado', 'vencido', 'cancelado')),
  monto                 numeric(14, 2),
  fecha_inicio          date,
  fecha_vencimiento     date,
  fecha_firma           date,
  responsable_id        uuid references sgc.usuarios(id),
  creado_por            uuid references sgc.usuarios(id),
  created_at            timestamptz not null default now()
);
create index idx_contratos_proyecto on sgc.contratos(proyecto_id);
create index idx_contratos_estado on sgc.contratos(estado);
create index idx_contratos_vencimiento on sgc.contratos(fecha_vencimiento);

alter table sgc.contratos enable row level security;

create policy "contratos: select" on sgc.contratos for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "contratos: insert" on sgc.contratos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "contratos: update" on sgc.contratos for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));
create policy "contratos: delete" on sgc.contratos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal'));

grant select, insert, update, delete on sgc.contratos to authenticated;
grant usage, select on sequence sgc.contratos_codigo_seq to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3. Aprobaciones legales — cross-module approval queue. Any module can
--    insert a request naming itself as modulo_origen; only Legal/admin
--    can resolve it. The requester can always see their own request's
--    status (poll-free UI: they just re-check estado).
-- ═══════════════════════════════════════════════════════════
create table sgc.aprobaciones_legales (
  id               uuid primary key default gen_random_uuid(),
  modulo_origen    text not null check (modulo_origen in ('compras', 'rrhh', 'proyectos', 'inventario', 'documentos', 'flota', 'otro')),
  referencia_tipo  text,
  referencia_id    uuid,
  titulo           text not null,
  descripcion      text,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  solicitado_por   uuid not null references sgc.usuarios(id),
  revisado_por     uuid references sgc.usuarios(id),
  comentario_revisor text,
  fecha_solicitud  timestamptz not null default now(),
  fecha_resolucion timestamptz
);
create index idx_aprobaciones_legales_estado on sgc.aprobaciones_legales(estado);
create index idx_aprobaciones_legales_solicitante on sgc.aprobaciones_legales(solicitado_por);

alter table sgc.aprobaciones_legales enable row level security;

create policy "aprobaciones_legales: select" on sgc.aprobaciones_legales for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('legal') or solicitado_por = auth.uid());
create policy "aprobaciones_legales: insert" on sgc.aprobaciones_legales for insert to authenticated
  with check (solicitado_por = auth.uid());
create policy "aprobaciones_legales: update" on sgc.aprobaciones_legales for update to authenticated
  using ((sgc.is_admin() or sgc.tiene_modulo('legal')) and estado = 'pendiente')
  with check (
    revisado_por = auth.uid()
    and estado in ('aprobado', 'rechazado')
  );

grant select, insert, update on sgc.aprobaciones_legales to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4. Storage bucket for expediente attachments — private, scoped to
--    Legal/admin only (case files are more sensitive than project docs,
--    so unlike sgc-documentos this is not readable by anyone with a
--    generic module flag). Upload path convention:
--    `${expedienteId}/${uuid}-${filename}`.
-- ═══════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sgc-legal', 'sgc-legal', false, 26214400,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/pdf',
    'image/png', 'image/jpeg'
  ]
)
on conflict (id) do nothing;

create policy "sgc-legal: scoped read" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-legal' and (sgc.is_admin() or sgc.tiene_modulo('legal')));
create policy "sgc-legal: scoped upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-legal' and (sgc.is_admin() or sgc.tiene_modulo('legal')));
create policy "sgc-legal: scoped delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sgc-legal' and (sgc.is_admin() or sgc.tiene_modulo('legal')));

-- ═══════════════════════════════════════════════════════════
-- 5. New 'legal' module: grant it to admin immediately (the recurring
--    gotcha from fix-admin-modulos-and-embeds.sql — admin's modulos array
--    does NOT auto-update when a new module key is introduced in code).
--    A dedicated "Abogado" role should be created via Admin > Roles once
--    this ships, with only the 'legal' module checked.
-- ═══════════════════════════════════════════════════════════
update sgc.roles set modulos = array_append(modulos, 'legal')
  where codigo = 'admin' and not ('legal' = any(modulos));
