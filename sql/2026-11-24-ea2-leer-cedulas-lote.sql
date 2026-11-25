-- ============================================================================
-- EA2 -- Fotos del personal de obra por lote tras importar el Excel
-- (edge `leer-cedulas-lote`). Aditivo, fechado e idempotente.
-- Reversa: sql/_reversa/2026-11-24-ea2-leer-cedulas-lote.reversa.sql
--
-- Solo SIEMBRA PARAMETROS (editables en Config; la edge los lee con service_role
-- y cae a estos mismos defaults si faltan). No toca tablas de negocio, RLS ni grants:
--   * el registro de uso ya existe (`sgc.uso_ia`, funcion = 'leer_cedulas_lote',
--     SOLO metadatos: tokens/costo, meta vacio — nunca imagen ni transcripcion);
--   * las fotos definitivas van por el flujo de siempre (bucket PRIVADO `personal-obra`,
--     `sgc.personal_obra_fotos`), con sus politicas ya existentes (AR1/AR1c).
--   * `sgc.parametros` tiene RLS de lectura para authenticated y escritura de admin/service.
--
-- Aplicar (dev primero, regla BU1/CD10):
--   node scripts/apply-migration.mjs sql/2026-11-24-ea2-leer-cedulas-lote.sql --env dev
-- ============================================================================

insert into sgc.parametros (clave, valor, descripcion) values
  ('leer_cedulas_lote_limite_usuario_hora', '300',
   'EA2 — maximo de imagenes de cedula/pasaporte leidas con IA por usuario por hora (import de personal de obra por lote).'),
  ('leer_cedulas_lote_limite_diario', '600',
   'EA2 — maximo de imagenes leidas con IA por dia en todo el sistema (lector de cedulas por lote).'),
  ('leer_cedulas_confianza_min', '0.85',
   'EA2 — confianza minima (0 a 1) para que una lectura asigne una foto a una persona del Excel; por debajo queda «Sin asignar».')
on conflict (clave) do nothing;
