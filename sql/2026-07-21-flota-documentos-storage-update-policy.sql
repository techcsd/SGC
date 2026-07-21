-- ============================================================================
-- 2026-07-21 — flota-documentos (Storage): agregar policy UPDATE (fix definitivo
--              de la subida de cédula/licencia desde la app móvil).
-- ----------------------------------------------------------------------------
-- CAUSA RAÍZ (verificada): la app sube las fotos con `upsert: true`. Cuando un
-- envío se reintenta y el objeto YA existe en Storage (p. ej. la foto se subió
-- en la captura original y el envío quedó atascado), Storage ejecuta un UPDATE
-- sobre `storage.objects`. TODOS los buckets de campo (vehiculos, conduces,
-- inventario, obra, reportes) tienen su policy UPDATE por esto — pero
-- `flota-documentos` (creado por SGC web) tenía solo INSERT/SELECT/DELETE. Sin
-- policy UPDATE, el re-upload fallaba con "new row violates row-level security
-- policy", que se veía en la app como documento atascado en "Pendientes".
--
-- Cambio ADITIVO/PERMISIVO: UPDATE para cualquier `authenticated` chequeando solo
-- el `bucket_id`, idéntico al patrón de los demás buckets de campo. No rompe nada.
-- ============================================================================

set search_path = sgc, public;

drop policy if exists flota_docs_upd on storage.objects;
create policy flota_docs_upd on storage.objects
  for update to authenticated
  using (bucket_id = 'flota-documentos')
  with check (bucket_id = 'flota-documentos');
