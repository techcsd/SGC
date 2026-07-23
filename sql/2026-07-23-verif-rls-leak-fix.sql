-- ============================================================================
-- VERIFICACIÓN-TOTAL — QA de RBAC en vivo (14 usuarios de prueba por rol).
-- ----------------------------------------------------------------------------
-- Hallazgo del QA por rol: 4 tablas OPERATIVAS de inventario/compras tenían su
-- política SELECT correctamente scopeada por módulo PERO también una política
-- PERMISSIVE heredada `USING (true)` para `authenticated`. Como las políticas
-- permissive se combinan con OR, el `true` ANULABA el scope → cualquier usuario
-- autenticado (abogado, chofer, rrhh, tecnología…) leía TODAS las filas de:
--   salidas_inventario, stock_por_bodega, bodegas, proveedores.
-- Es el mismo patrón que el "RLS lockdown" (2026-07-02) quitó del resto de
-- tablas; estas 4 se le escaparon. Los catálogos de referencia (articulos,
-- unidades, motivos_multa, categorias_inventario, estaciones_combustible,
-- licencia_categorias, bitacora_catalogos, flota_config, roles, weather_*)
-- mantienen su lectura abierta A PROPÓSITO (patrón "leer todos / escribir
-- gateado") — no se tocan.
--
-- Fix: (1) DROP de las políticas `true` heredadas; (2) ampliar la política
-- scopeada de stock_por_bodega/bodegas a `compras` (el picker de artículos —
-- T13b — se usa en Requisición y OC, flujos de compras, y muestra stock/bodega)
-- y la de proveedores a `inventario` (las entradas referencian proveedor).
-- Así se cierra la fuga sin romper accesos legítimos cross-módulo.
-- Reversible; sin cambio de datos.
-- ============================================================================

set search_path = sgc, public;

-- 1) salidas_inventario — quitar el `true`; el scope real ya cubre
--    inventario / miembros del proyecto / admin·logística·gerencia.
drop policy if exists "salidas: read" on sgc.salidas_inventario;

-- 2) stock_por_bodega — quitar el `true` y permitir también a compras
--    (el picker de artículos muestra stock por bodega en Requisición/OC).
drop policy if exists "stock_por_bodega: read" on sgc.stock_por_bodega;
alter policy "stock_por_bodega: select" on sgc.stock_por_bodega
  using (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras'));

-- 3) bodegas — quitar los dos `true` y permitir también a compras (idem picker).
drop policy if exists "bodegas: read" on sgc.bodegas;
drop policy if exists "bodegas_select" on sgc.bodegas;
alter policy "bodegas: select" on sgc.bodegas
  using (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('compras'));

-- 4) proveedores — quitar el `true` y permitir también a inventario
--    (entradas de inventario referencian al proveedor).
drop policy if exists "proveedores_select" on sgc.proveedores;
alter policy "proveedores: select" on sgc.proveedores
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario'));
