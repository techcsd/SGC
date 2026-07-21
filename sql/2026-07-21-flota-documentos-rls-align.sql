-- ============================================================================
-- 2026-07-21 — Alinear la RLS de subida de DOCUMENTOS con el resto de buckets de
--              campo de la app (fix: subida de cédula/licencia desde el móvil).
-- ----------------------------------------------------------------------------
-- Los buckets de campo `vehiculos` / `conduces` / `inventario` / `obra` permiten
-- INSERT a cualquier usuario `authenticated` (sus policies solo chequean el
-- `bucket_id`). En cambio `flota-documentos` (Storage) y `sgc.documentos` (tabla)
-- exigían `is_admin() OR tiene_modulo('flota')`, lo que bloqueaba la subida de
-- documentos desde la app con "new row violates row-level security policy" cuando
-- la sesión del outbox no satisfacía ese gate (los demás buckets no lo tienen).
--
-- Cambio ADITIVO/PERMISIVO (solo AFLOJA el INSERT, nunca rompe a quien ya podía):
-- INSERT para cualquier `authenticated`, igual que los otros buckets de campo.
-- SELECT/DELETE quedan igual (siguen restringidos). El vaciado/entidad se sigue
-- validando por FK y por la lógica de la app.
-- ============================================================================

set search_path = sgc, public;

-- ── Tabla sgc.documentos — INSERT para cualquier autenticado ────────────────
drop policy if exists documentos_ins on sgc.documentos;
create policy documentos_ins on sgc.documentos
  for insert to authenticated
  with check (true);

-- ── Storage: bucket flota-documentos — INSERT solo por bucket_id ────────────
-- (mismo patrón que csd_field_buckets_insert / obra_bucket_insert).
drop policy if exists flota_docs_ins on storage.objects;
create policy flota_docs_ins on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flota-documentos');
