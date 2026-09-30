-- ============================================================================
-- CD0 (hotfix, regla 5 / audit-buckets) — bucket `outbox-atascados` sin política
-- UPDATE. CC7 lo creó con INSERT ("sube dueno") + SELECT ("lee tec"), pero la app
-- (csd-app, PROMPT-75) sube la evidencia con upsert:true. Un REINTENTO re-sube la
-- MISMA ruta → UPDATE en storage.objects → "new row violates row-level security
-- policy" sin política UPDATE. Mismo patrón que BI1 (sgc-bitacora). El guard
-- audit-buckets-upsert-policy.mjs lo detecta.
--
-- Fix: política UPDATE espejo de la INSERT (el dueño, en su carpeta <uid>/...).
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd0-outbox-atascados-update-policy.sql --env dev  →  --env prod
-- ============================================================================
begin;

drop policy if exists "outbox-atascados actualiza dueno" on storage.objects;
create policy "outbox-atascados actualiza dueno" on storage.objects
  for update to authenticated
  using      (bucket_id = 'outbox-atascados' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'outbox-atascados' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
