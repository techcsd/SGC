-- =============================================================================
-- PROMPT-28 (BG) FASE 2 — BG5: `solicitudes_material_estado_check` desactualizado.
-- Ronda 19/08-03/09/2026. Aditivo (amplía la lista permitida), idempotente.
--
-- BUG (captura): cancelar REQ-000026 (Eduardo NG) →
--   `new row for relation "solicitudes_material" violates check constraint
--    "solicitudes_material_estado_check"`.
-- CAUSA (prima de BF1): el constraint solo permitía los 5 estados originales
--   ('pendiente','aprobada','rechazada','entregada','cerrada'), pero BA6 (Transporte
--   v3 — despachos) añadió estados en CÓDIGO sin actualizar el constraint:
--     · `requisicion_cancelar`  escribe 'cancelada'   (← el que revienta)
--     · flujo auto_conduce OFF   escribe 'por_despachar'
--     · `requisicion_cerrar`     escribe 'completada'
--   y el enum TS (`solicitud.model.ts`) declara además 'parcial' (reservado para
--   despacho parcial). BF6 (rechazada→corregir→reenviar) NO añade estado nuevo:
--   una requisición corregida vuelve a 'pendiente'.
--
-- FIX: recrear el constraint con la lista COMPLETA de estados vigentes (los 5
--   originales + los 4 de BA6). Amplía, no restringe → ninguna fila existente lo
--   viola. `parcial` se incluye aunque hoy no lo escriba ningún RPC: el enum TS lo
--   promete y el despacho parcial lo escribirá.
--
-- Regla permanente que estrena (3ª del checklist de migraciones, junto al RLS de
-- BC7 y el NOT-NULL de BF1): **estado nuevo ⇒ constraint/enum actualizado en la
-- MISMA migración**, + smoke de cada transición. Ver docs/CHECKLIST-MIGRACIONES.md.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-01-bg5-requisicion-estado-constraint.sql
-- =============================================================================
begin;

alter table sgc.solicitudes_material
  drop constraint if exists solicitudes_material_estado_check;

alter table sgc.solicitudes_material
  add constraint solicitudes_material_estado_check
  check (estado in (
    -- originales
    'pendiente', 'aprobada', 'rechazada', 'entregada', 'cerrada',
    -- BA6 (Transporte v3 — despachos)
    'por_despachar', 'parcial', 'completada', 'cancelada'
  ));

commit;
