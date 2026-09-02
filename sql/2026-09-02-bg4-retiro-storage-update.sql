-- =============================================================================
-- PROMPT-29 (BG4) — Storage: política UPDATE para el bucket `sgc-retiro`.
-- Ronda 19/08-03/09/2026. Aditivo, idempotente.
--
-- El outbox sube las fotos con upsert:true (idempotencia de reenvío). Un reintento
-- post-fix RE-sube la misma ruta → es un UPDATE del objeto, que exige política
-- UPDATE (el bucket solo traía INSERT+SELECT). Sin ella, el reintento fallaría con
-- "violates row-level security policy" (42501) — justo el patrón que esta tanda
-- viene a cerrar. Regla recurrente: todo bucket usado con upsert necesita
-- INSERT + UPDATE, no solo INSERT (ver storage-upsert-needs-update-policy).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-02-bg4-retiro-storage-update.sql
-- =============================================================================
begin;

drop policy if exists "sgc-retiro: authenticated update" on storage.objects;
create policy "sgc-retiro: authenticated update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sgc-retiro')
  with check (bucket_id = 'sgc-retiro');

commit;
