-- Documentos por proyecto: contrato, presupuesto, cronograma, manual de ejecución.
-- Uploaded by admin/proyectos staff, viewable in-page by them + engineers assigned
-- to that proyecto (via proyecto_empleados). Manuals (.docx) get their content
-- parsed client-side (mammoth) into contenido_html so they render inline, no download.

create table sgc.documentos_proyecto (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references sgc.proyectos(id) on delete cascade,
  tipo           text not null check (tipo in ('contrato', 'presupuesto', 'cronograma', 'manual_ejecucion', 'otro')),
  nombre         text not null,
  archivo_path   text not null,
  tipo_mime      text,
  contenido_html text,
  subido_por     uuid references sgc.usuarios(id),
  created_at     timestamptz not null default now()
);
create index idx_documentos_proyecto on sgc.documentos_proyecto(proyecto_id);

alter table sgc.documentos_proyecto enable row level security;

create policy "documentos_proyecto: select" on sgc.documentos_proyecto for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('proyectos')
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = documentos_proyecto.proyecto_id and e.usuario_id = auth.uid()
    )
  );
create policy "documentos_proyecto: insert" on sgc.documentos_proyecto for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "documentos_proyecto: delete" on sgc.documentos_proyecto for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
grant select, insert, delete on sgc.documentos_proyecto to authenticated;

insert into storage.buckets (id, name, public)
values ('sgc-documentos', 'sgc-documentos', false)
on conflict (id) do nothing;

create policy "sgc-documentos: authenticated read" on storage.objects for select to authenticated
  using (bucket_id = 'sgc-documentos');
create policy "sgc-documentos: authenticated upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-documentos');
create policy "sgc-documentos: authenticated delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sgc-documentos');
