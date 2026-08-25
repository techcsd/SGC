-- ============================================================================
-- AX2 — Acceso de Capataz por cédula (patrón chofer generalizado).
--  1) Vínculo usuario ↔ ficha de personal de obra (espejo de conductores.usuario_id).
--  2) Matriz del Capataz: módulo `bitacora` (ve "Entregas por firmar" + sus partes);
--     "Mis tareas" no requiere módulo. Sin incentivo, sin flota, sin inventario.
--     (Confirmar entregas de su obra se habilita cuando el capataz es responsable
--      de la obra — se cubre por la matriz AX1; ver nota en el edge.)
-- Aditivo y retrocompatible.
-- ============================================================================

alter table sgc.personal_obra add column if not exists usuario_id uuid references sgc.usuarios(id);
create index if not exists idx_personal_obra_usuario on sgc.personal_obra(usuario_id);

-- Matriz mínima del Capataz (solo si aún no tiene módulos, para no pisar ajustes).
update sgc.roles
   set modulos = array['bitacora']::text[]
 where codigo = 'capataz' and coalesce(array_length(modulos, 1), 0) = 0;
