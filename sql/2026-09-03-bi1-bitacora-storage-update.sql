-- =============================================================================
-- PROMPT-32 (BI1) — Storage: la política UPDATE que le faltaba a `sgc-bitacora`.
-- Ronda 03/09/2026. Aditivo, idempotente.
--
-- CAUSA RAÍZ (verificada, y por fin la de verdad):
-- La app sube las fotos de la bitácora ANTES de llamar la RPC, con `upsert: true`
-- (csd-app/src/app/core/sync/sync.service.ts:695) a una ruta DETERMINISTA
-- (bitacora.service.ts:483-484: `${id}/foto_${i}.jpg`, bucket 'sgc-bitacora').
--   · 1er intento: el objeto no existe → INSERT en storage.objects → permitido.
--   · Todo REINTENTO: la misma ruta ya existe + upsert → Storage ejecuta un
--     UPDATE sobre storage.objects → SIN política UPDATE → denegado con
--     "new row violates row-level security policy". El reintento muere en la
--     foto #1, ANTES de llegar a la bitácora. El error nunca fue de la bitácora.
--
-- `sgc-bitacora` nació (2026-07-02-bitacora.sql:140-143) con SÓLO select+insert y
-- nunca recibió UPDATE — el ÚNICO de los buckets de campo usados con upsert. El
-- repo documentó este patrón dos veces (2026-07-21-flota-documentos-storage-update
-- -policy.sql y 2026-09-02-bg4-retiro-storage-update.sql) y lo aplicó a 8 buckets.
-- A éste, no. Esta migración cierra el rescate de las bitácoras del ingeniero
-- atascadas desde el 20 de agosto — SIN perder su data.
--
-- Regla 5 del checklist de migraciones: todo bucket usado con `upsert: true` nace
-- con INSERT *y* UPDATE. Auditada por scripts/audit-buckets-upsert-policy.mjs.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-03-bi1-bitacora-storage-update.sql
-- =============================================================================
begin;

drop policy if exists "sgc-bitacora: authenticated update" on storage.objects;
create policy "sgc-bitacora: authenticated update" on storage.objects
  for update to authenticated
  using (bucket_id = 'sgc-bitacora')
  with check (bucket_id = 'sgc-bitacora');

commit;
