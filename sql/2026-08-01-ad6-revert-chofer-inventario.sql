-- ============================================================================
-- AD6 (revert) — Quitar el acceso TEMPORAL de los choferes al módulo Inventario.
--
-- ⚠️ APLICAR SOLO DESPUÉS de publicar la app csd-app con las funciones de
--    inventario del chofer DENTRO de Transporte (PROMPT-16 FASE 3: "Recibir
--    mercancía", "Compra en ferretería", rutas por tipo). Si se aplica antes,
--    los choferes con la app vieja se quedan sin herramientas.
--
-- Coordinación: PROMPT-15 FASE 5 dejó 'inventario' en el rol Chofer/Transportista
-- a propósito (docs/CHOFER-FLUJO.md). Este script cierra ese pendiente.
--
-- Idempotente y reversible (array_remove no falla si ya no está).
-- ============================================================================

update sgc.roles
   set modulos = array_remove(modulos, 'inventario')
 where (nombre ilike '%chofer%' or nombre ilike '%transportista%')
   and 'inventario' = any(modulos);

-- Verificación (debería quedar solo ['flota','transporte'] en el rol chofer):
--   select id, nombre, modulos from sgc.roles
--    where nombre ilike '%chofer%' or nombre ilike '%transportista%';
