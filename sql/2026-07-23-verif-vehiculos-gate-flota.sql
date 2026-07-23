-- ============================================================================
-- VERIFICACIÓN-TOTAL — gatear vehiculos por módulo flota.
-- ----------------------------------------------------------------------------
-- El QA de RBAC mostró que la política SELECT de vehiculos era
--   (activo = true) OR es_flota_elevado()
-- → cualquier usuario autenticado (abogado, rrhh, tecnología…) veía los
-- vehículos activos, sin requerir el módulo Flota. Por decisión de Xaviel se
-- gatea por módulo:
--   - Usuarios con módulo flota (incluye admin/direccion/gerencia/jefe_flota y
--     chofer): ven los vehículos ACTIVOS.
--   - Elevados (es_flota_elevado): ven TODOS, incl. inactivos (regla previa).
--   - El resto: no ven ninguno.
-- Los RPCs SECURITY DEFINER (mis_rutas, etc.) no se ven afectados. La política
-- RESTRICTIVE de es_prueba sigue vigente. Reversible, sin cambio de datos.
-- ============================================================================

set search_path = sgc, public;

alter policy "vehiculos: select" on sgc.vehiculos
  using ((activo = true and sgc.tiene_modulo('flota')) or sgc.es_flota_elevado());
