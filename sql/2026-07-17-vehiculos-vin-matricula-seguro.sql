-- ============================================================================
-- Ronda 17/07/2026 — V1: VIN · V2: números de matrícula y seguro
-- ----------------------------------------------------------------------------
-- Columnas aditivas en vehiculos. Retrocompatible. Las FOTOS de matrícula/seguro
-- ya se suben por `sgc.documentos` (slots matricula/seguro) y las FECHAS de
-- vencimiento ya existían (vencimiento_matricula/vencimiento_seguro).
-- ============================================================================

set search_path = sgc, public;

alter table sgc.vehiculos
  add column if not exists vin              text,  -- V1 chasis
  add column if not exists numero_matricula text,  -- V2
  add column if not exists numero_seguro    text,  -- V2 (nº de póliza)
  add column if not exists aseguradora      text;  -- V2 (compañía)

-- V1 — VIN único cuando está presente (case-insensitive). Parcial: no bloquea
-- los vehículos/maquinaria sin VIN (múltiples NULL permitidos).
create unique index if not exists uq_vehiculos_vin
  on sgc.vehiculos (upper(vin))
  where vin is not null and vin <> '';
