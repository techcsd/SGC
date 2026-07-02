-- User feedback / issue reports, visible to admin with a status workflow.
-- Any authenticated user can submit a comentario/bug/sugerencia; admin
-- manages it through abierto -> en_progreso -> resuelto/descartado,
-- optionally assigning it to themselves ("I'm working on this now") and
-- leaving a response.

create table sgc.reportes_usuario (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references sgc.usuarios(id),
  tipo           text not null check (tipo in ('comentario', 'bug', 'sugerencia')),
  asunto         text not null check (char_length(btrim(asunto)) > 0),
  descripcion    text not null check (char_length(btrim(descripcion)) > 0),
  estado         text not null default 'abierto'
                   check (estado in ('abierto', 'en_progreso', 'resuelto', 'descartado')),
  asignado_a     uuid references sgc.usuarios(id),
  respuesta_admin text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resuelto_en    timestamptz
);
create index idx_reportes_usuario_usuario on sgc.reportes_usuario(usuario_id);
create index idx_reportes_usuario_estado on sgc.reportes_usuario(estado);

alter table sgc.reportes_usuario enable row level security;

create policy "reportes_usuario: select" on sgc.reportes_usuario for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin());

create policy "reportes_usuario: insert" on sgc.reportes_usuario for insert to authenticated
  with check (usuario_id = auth.uid());

-- Only admin manages status/assignment/response; the reporting user cannot
-- edit their own report after submitting (keeps a clean, honest history).
create policy "reportes_usuario: update" on sgc.reportes_usuario for update to authenticated
  using (sgc.is_admin())
  with check (sgc.is_admin());

grant select, insert, update on sgc.reportes_usuario to authenticated;
