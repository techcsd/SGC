-- ============================================================================
-- Actualización 1 — P4 (opcional): reclasificar vehículos que hoy están en 'otro'
-- ----------------------------------------------------------------------------
-- Propuesta mostrada y CONFIRMADA por Xaviel antes de aplicar. Solo toca filas
-- con tipo='otro' y placa específica (idempotente; no revierte nada ya movido).
-- El "Hyundai Cantus" se deja en 'otro' (modelo no identificable con certeza).
-- ============================================================================

set search_path = sgc, public;

update sgc.vehiculos set tipo = 'automovil'  where tipo = 'otro' and placa = 'A631739';   -- Chevrolet Malibu LS
update sgc.vehiculos set tipo = 'suv'        where tipo = 'otro' and placa = 'G661182';   -- Chevrolet Suburban Premier 4WD
update sgc.vehiculos set tipo = 'motocicleta' where tipo = 'otro' and placa = 'K2347567';  -- Husqvarna Svartpilen 250
update sgc.vehiculos set tipo = 'automovil'  where tipo = 'otro' and placa = 'A0893203';  -- Lexus IS 350 F Sport
update sgc.vehiculos set tipo = 'suv'        where tipo = 'otro' and placa = 'G478637';   -- Suzuki Jimmy 4WD
-- G675571 Hyundai "Cantus" → se mantiene 'otro' (modelo no identificable).
