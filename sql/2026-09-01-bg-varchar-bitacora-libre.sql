-- =============================================================================
-- PROMPT-28 (BG) FASE 5 — varchar(50) que rechazó la 3ª bitácora atascada.
-- Ronda 19/08-03/09/2026. Aditivo (amplía longitud), idempotente, retrocompatible.
--
-- BUG (captura): un envío de bitácora (10 fotos) atascado con
--   `value too long for type character varying(50)` (SQLSTATE 22001).
-- CAUSA: `bitacora_actividades.estructura` es varchar(50); su CHECK-allowlist se
--   ELIMINÓ (2026-07-11) y desde Z14/Z20/AZ6 se permite estructura de texto libre
--   ("Otro"). Un nombre de estructura > 50 chars tecleado por el ingeniero revienta,
--   sin guarda en el cliente. Las hermanas de texto libre del mismo flujo —
--   `actividad` (60) y `tipo_restriccion` (60) — corren el mismo riesgo.
--
-- FIX (lado servidor, ambos lados por §D): ampliar las 3 columnas de texto libre de
--   bitácora a varchar(200). El contador/limite en el cliente va en la app
--   (PROMPT-29 F5) y en el form web. Ampliar longitud nunca trunca datos existentes.
--
-- Auditadas las demás varchar cortas de sgc que reciben texto de usuario: solo
--   estas 3 son de texto libre; `activos.tipo`(30) e `historial_activos.tipo_cambio`(50)
--   son valores controlados por el sistema (no texto libre del usuario) → se dejan.
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-01-bg-varchar-bitacora-libre.sql
-- =============================================================================
begin;

alter table sgc.bitacora_actividades   alter column estructura       type varchar(200);
alter table sgc.bitacora_actividades   alter column actividad        type varchar(200);
alter table sgc.bitacora_restricciones alter column tipo_restriccion type varchar(200);

commit;
