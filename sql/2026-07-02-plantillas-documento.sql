-- Document template engine: pre-built templates (contrato, recibo de pago, orden de
-- pago, acta de incidencia) seeded from real CSD templates, plus user-uploaded custom
-- templates. Both work the same way: HTML body with {{token}} placeholders, a form
-- derived from those tokens, fill -> editable preview -> save + print/download.

create table sgc.plantillas_documento (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  categoria      text not null check (categoria in
    ('contrato', 'recibo_pago', 'orden_pago', 'carta_entrega', 'acta_incidencia', 'otro')),
  contenido_html text not null,
  campos         jsonb not null default '[]',
  origen         text not null default 'sistema' check (origen in ('sistema', 'usuario')),
  creado_por     uuid references sgc.usuarios(id),
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table sgc.documentos_generados (
  id                   uuid primary key default gen_random_uuid(),
  plantilla_id         uuid not null references sgc.plantillas_documento(id),
  proyecto_id          uuid references sgc.proyectos(id),
  nombre               text not null,
  valores              jsonb not null default '{}',
  contenido_html_final text not null,
  generado_por         uuid references sgc.usuarios(id),
  created_at           timestamptz not null default now()
);
create index idx_documentos_generados_plantilla on sgc.documentos_generados(plantilla_id);
create index idx_documentos_generados_proyecto on sgc.documentos_generados(proyecto_id);

alter table sgc.plantillas_documento enable row level security;
create policy "plantillas_documento: select" on sgc.plantillas_documento for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('documentos'));
create policy "plantillas_documento: insert" on sgc.plantillas_documento for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('documentos'));
create policy "plantillas_documento: update" on sgc.plantillas_documento for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('documentos'));
create policy "plantillas_documento: delete" on sgc.plantillas_documento for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('documentos'));
grant select, insert, update, delete on sgc.plantillas_documento to authenticated;

alter table sgc.documentos_generados enable row level security;
create policy "documentos_generados: select" on sgc.documentos_generados for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('documentos'));
create policy "documentos_generados: insert" on sgc.documentos_generados for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('documentos'));
create policy "documentos_generados: delete" on sgc.documentos_generados for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('documentos'));
grant select, insert, delete on sgc.documentos_generados to authenticated;

-- New module: admin gets it immediately; other roles can be granted it later via Admin > Roles.
update sgc.roles set modulos = array['inventario','compras','rrhh','proyectos','flota','bitacora','documentos','admin']
  where codigo = 'admin';
