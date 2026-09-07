-- ============================================================================
-- BJ1 — Límite de tamaño en los buckets que no tenían ninguno.
--
-- Hoy un archivo de 40 MB entra a sgc-bitacora sin objeción (guardas de cliente
-- solo había dos). Con la compresión en captura (comprimir-imagen.util con perfiles)
-- las fotos bajan mucho, pero el límite del bucket es la red dura server-side.
--
-- UPDATE idempotente (no-op si el bucket no existe todavía en este entorno).
-- Límites por naturaleza del bucket:
--   · fotos (evidencia)      → 15 MB
--   · documentos (pdf/xlsx)  → 26 MB
--   · stickers               →  3 MB
-- ============================================================================

begin;

-- Fotos de evidencia
update storage.buckets set file_size_limit = 15728640  -- 15 MB
  where id in ('sgc-bitacora', 'obra', 'reportes', 'qa', 'sgc-jira', 'sgc-retiro', 'sgc-articulos');

-- Documentos (PDF/Office/planos)
update storage.buckets set file_size_limit = 27262976  -- 26 MB
  where id in ('sgc-documentos', 'flota-documentos', 'sgc-cronograma');

-- Stickers (pequeños por definición)
update storage.buckets set file_size_limit = 3145728   -- 3 MB
  where id in ('sgc-stickers');

commit;
