-- ============================================================================
-- Actualización 2 — FASE 5 (Inventario/Tecnología). Cambio de BD: U17.
-- U17 — foto en inventario tecnológico. La foto se guarda en el bucket privado
-- `inventario` (path tec-equipo/{id}/…); aquí solo se agrega el path en la fila.
-- U16 (vista v_movimientos_inventario), U22 (bodegas.latitud/longitud) y U5
-- (normalizar_telefono) ya están en la migración de FASE 1.
-- ============================================================================
set search_path = sgc, public;

alter table sgc.tec_equipos add column if not exists foto_path text;
