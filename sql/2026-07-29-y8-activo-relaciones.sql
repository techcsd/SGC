-- ============================================================================
-- Y8 — Activo fijo: relación a obra / empleado / ingeniero / almacén / vehículo
-- ADITIVO / RETROCOMPATIBLE
-- ============================================================================
-- La nota original de Xaviel ("nuevo Activo Fijo — the relation to…") quedó
-- cortada; el 29-jul definió: un activo fijo debe poder relacionarse a UNA de
-- {obra (proyecto), empleado, ingeniero (usuario), almacén (bodega), vehículo}.
-- Se modela polimórfico (asignado_tipo + asignado_id): una sola asignación a la
-- vez, sin multiplicar columnas. Ambas nullable → los activos existentes quedan
-- sin asignación (comportamiento idéntico al de hoy). El nombre de la entidad se
-- resuelve en el cliente con las listas ya cargadas (sin FK dura por ser polimórfico).
-- ============================================================================

alter table sgc.activos_fijos
  add column if not exists asignado_tipo text
    check (asignado_tipo in ('proyecto','empleado','ingeniero','almacen','vehiculo'));

alter table sgc.activos_fijos
  add column if not exists asignado_id uuid;

comment on column sgc.activos_fijos.asignado_tipo is
  'Y8 — tipo de entidad relacionada: proyecto|empleado|ingeniero(usuario)|almacen(bodega)|vehiculo';
comment on column sgc.activos_fijos.asignado_id is
  'Y8 — id de la entidad relacionada según asignado_tipo (sin FK: polimórfico)';

create index if not exists idx_activos_asignado
  on sgc.activos_fijos(asignado_tipo, asignado_id)
  where asignado_id is not null;
