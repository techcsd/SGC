-- ============================================================================
-- AB3 — Mantenimientos: registrar "quién lo registró" (29/07/2026 PM)
-- ----------------------------------------------------------------------------
-- El detalle de mantenimiento (fila → detalle) debe mostrar quién lo registró,
-- pero la tabla no tenía columna de usuario (ver nota en r14-flota-rls-scoping).
-- Migración ADITIVA: se agrega `creado_por` con default auth.uid() para que los
-- registros NUEVOS queden atribuidos automáticamente sin tocar el insert de la
-- app. Los históricos quedan en NULL (se muestran como "—").
-- ============================================================================

set search_path = sgc, public;

alter table sgc.mantenimientos
  add column if not exists creado_por uuid references sgc.usuarios(id) default auth.uid();

comment on column sgc.mantenimientos.creado_por is
  'Usuario que registró el mantenimiento (default auth.uid() en el insert). NULL en históricos previos a AB3.';
