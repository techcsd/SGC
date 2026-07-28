-- ============================================================================
-- Y15 — Cronograma · bucket de evidencia de tareas (aplicado en prod 28/07/2026)
-- ============================================================================
-- Bucket privado para la foto obligatoria al completar una tarea. Políticas
-- simples (mismo patrón que sgc-bitacora): authenticated sube y lee; el acceso
-- fino lo da la app vía signed URLs. Aditivo.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('sgc-cronograma', 'sgc-cronograma', false)
on conflict (id) do nothing;

drop policy if exists "sgc-cronograma: authenticated upload" on storage.objects;
create policy "sgc-cronograma: authenticated upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-cronograma');

drop policy if exists "sgc-cronograma: authenticated read" on storage.objects;
create policy "sgc-cronograma: authenticated read"
  on storage.objects for select to authenticated
  using (bucket_id = 'sgc-cronograma');
