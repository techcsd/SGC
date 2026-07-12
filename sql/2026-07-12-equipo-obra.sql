-- ============================================================================
-- A3.2 — Equipo de Obra por proyecto — reunión 07/07/2026 (CSD-OPE-01 §5)
-- ----------------------------------------------------------------------------
-- Amplía proyecto_empleados a un catálogo de equipo de obra:
--   * rol del catálogo autoritativo (residente, responsable, guarda-almacén, …)
--   * entidades externas (topógrafo subcontratado, subcontratistas) sin empleado
--   * vigencia (desde/hasta) y estado activo
-- Aditivo y retro-compatible: empleado_id pasa a nullable; filas existentes
-- (todas con empleado) siguen válidas. La app de campo solo lee esta tabla.
-- ============================================================================
set search_path = sgc, public;

alter table sgc.proyecto_empleados alter column empleado_id drop not null;

alter table sgc.proyecto_empleados
  add column if not exists externo_nombre text,
  add column if not exists externo_tipo   text,   -- 'topografia' | 'subcontratista' | 'otro'
  add column if not exists desde           date,
  add column if not exists hasta           date,
  add column if not exists activo          boolean not null default true,
  add column if not exists notas           text;

comment on column sgc.proyecto_empleados.externo_nombre is
  'A3.2: nombre de la entidad externa (topógrafo/subcontratista) cuando no es un empleado de RRHH.';
comment on column sgc.proyecto_empleados.rol is
  'A3.2: rol del catálogo Equipo de Obra (ing_responsable, ing_residente, capataz, maestro_acero, maestro_encofrado, encargado_seguridad, guarda_almacen, topografo, cuadrilla, subcontratista).';

-- Integridad: cada miembro es un empleado O una entidad externa con nombre.
do $$ begin
  alter table sgc.proyecto_empleados
    add constraint proyecto_empleados_persona_chk
    check (empleado_id is not null or nullif(externo_nombre, '') is not null);
exception when duplicate_object then null; end $$;

create index if not exists idx_proyecto_empleados_rol on sgc.proyecto_empleados(proyecto_id, rol);
