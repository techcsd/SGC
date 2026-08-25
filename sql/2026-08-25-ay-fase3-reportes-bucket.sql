-- ============================================================================
-- AY FASE 3 — Archivos de Compa (AY11). Bucket privado `reportes` para los PDF
-- que genera el asistente. Cada usuario solo ve/gestiona los suyos (owner). El
-- archivo hereda permisos: se compone SOLO de datos que las tools del usuario
-- devolvieron (la tool ya filtró por RLS/identidad), así que un rol sin acceso
-- a un dato no obtiene su PDF.
-- ============================================================================

begin;

insert into storage.buckets (id, name, public)
values ('reportes', 'reportes', false)
on conflict (id) do nothing;

-- RLS: authenticated gestiona SOLO sus propios objetos del bucket `reportes`.
drop policy if exists "reportes: insert propio" on storage.objects;
create policy "reportes: insert propio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reportes' and owner = auth.uid());

drop policy if exists "reportes: select propio" on storage.objects;
create policy "reportes: select propio" on storage.objects
  for select to authenticated
  using (bucket_id = 'reportes' and owner = auth.uid());

drop policy if exists "reportes: delete propio" on storage.objects;
create policy "reportes: delete propio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'reportes' and owner = auth.uid());

commit;
