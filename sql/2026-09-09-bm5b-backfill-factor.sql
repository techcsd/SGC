-- ============================================================================
-- PROMPT-40 (BM) FASE 4 — BM5b: backfill del factor de empaque parseando `nota`.
-- Ronda 09/09/2026.  Idempotente.  ⚠️ LISTA A REVISIÓN DE XAVIEL antes de aplicar
-- (como la homologación de AU13) — el parseo se verificó contra prod (17/17 sin
-- ambigüedad), pero es data real y se aplica sólo con OK.
--
-- Requiere el esquema de bm5-factor-empaque-schema.sql.
--
-- Cada `nota` de estos 17 es EXACTAMENTE el factor (no una nota de verdad) → se
-- mueve a las columnas y se limpia `nota`.  Parseo verificado:
--   ATADO 120 PZA → factor 120 · ATADO 80 PZA → 80 · ATADO 60 PZA → 60
--   PAQUETE DE 50 UDS → 50
--
-- Apply: node scratchpad/apply-sql.mjs sql/2026-09-09-bm5b-backfill-factor.sql
-- ============================================================================

begin;

-- 'atado' no existe en el catálogo (sí 'paquete', 'unidad') → sembrarlo.
insert into sgc.unidades (codigo, nombre)
  select 'atado', 'Atado'
  where not exists (select 1 from sgc.unidades where codigo = 'atado');

-- PINO BRUTO — ATADO (madera). El factor estaba en la nota.
update sgc.articulos set unidad_paquete = 'atado', factor_paquete = 120, nota = null
  where codigo in ('CSD-02-001', 'CSD-02-004') and factor_paquete is null;   -- ATADO 120 PZA
update sgc.articulos set unidad_paquete = 'atado', factor_paquete = 80, nota = null
  where codigo in ('CSD-02-002', 'CSD-02-005') and factor_paquete is null;   -- ATADO 80 PZA
update sgc.articulos set unidad_paquete = 'atado', factor_paquete = 60, nota = null
  where codigo in ('CSD-02-003', 'CSD-02-006') and factor_paquete is null;   -- ATADO 60 PZA

-- TIES — PAQUETE DE 50 UDS (CSD-03-001 … CSD-03-011).
update sgc.articulos set unidad_paquete = 'paquete', factor_paquete = 50, nota = null
  where codigo in ('CSD-03-001','CSD-03-002','CSD-03-003','CSD-03-004','CSD-03-005','CSD-03-006',
                   'CSD-03-007','CSD-03-008','CSD-03-009','CSD-03-010','CSD-03-011')
    and factor_paquete is null;   -- PAQUETE DE 50 UDS

commit;

-- ── PENDIENTE (a decidir con la lista): los 8 artículos-EMPAQUE existentes ─────
-- (unidad = paquete/juego/resma; el empaque está en el NOMBRE, no hay twin base
--  confirmado).  Son el workaround viejo de BJ6.  Migrarlos al factor = FUSIÓN
--  (mover stock + referencias a un artículo base) — NO se hace aquí: necesita el
--  twin base confirmado, como AU18.  Candidatos con factor evidente en el nombre:
--    CSD-03-015  VARILLA de AMARRE 1/4 X 20' (PAQUETE de 30 UDS)   → factor 30
--    CSD-03-016  VARILLA LISA 5.5MM X 20' (PAQUETE de 30 UDS)      → factor 30
--    ALM-024     VARILLITAS 1/4 (PAQ. 30UDS)                       → factor 30
--    COC-011     JUEGO DE 6 VASOS DE ACRÍLICO                      → factor 6 (juego)
--    OFI-016 GRAPA (PAQ) · OFI-021 CLICK (PAQ)                     → factor ? (sin número)
--    OFI-003 RESMA 8X11 · OFI-004 RESMA 11X17                      → resma (500 conv.?)
