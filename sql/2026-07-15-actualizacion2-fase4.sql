-- ============================================================================
-- Actualización 2 — FASE 4 (Bitácora). Único cambio de BD: U11.
-- U11 — El clima ya se pregunta al inicio (lluvia); se desactiva "CLIMA" como
-- opción de restricción (histórico intacto: las bitácoras viejas guardan el
-- string 'CLIMA' y se siguen visualizando). U12/U13/U14/U15 son de frontend
-- (bitacora_restricciones.descripcion_otro ya existe → describa por selección
-- sin cambio de esquema).
-- ============================================================================
set search_path = sgc, public;

update sgc.bitacora_catalogos set activo = false
 where tipo = 'restriccion' and valor = 'CLIMA';
