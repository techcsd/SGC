-- ════════════════════════════════════════════════════════════════════════════
-- CH3 — Varios tipos de documento por mantenimiento. Nota #140.
--   El tipo ya es por archivo (mantenimiento_adjuntos.tipo_documento); la web lo
--   estampaba global. El front pasa a elegir el tipo POR archivo. Cuando el tipo
--   es "otro", se guarda una descripción corta ("¿Qué documento es?").
--   Única necesidad de BD: columna `descripcion` (aditiva, nullable). ADITIVO.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

alter table sgc.mantenimiento_adjuntos
  add column if not exists descripcion text;
comment on column sgc.mantenimiento_adjuntos.descripcion is
  'CH3 — detalle libre cuando tipo_documento = ''otro'' (ej. "Garantía del alternador").';

commit;
