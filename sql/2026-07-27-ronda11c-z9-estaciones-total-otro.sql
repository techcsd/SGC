-- ============================================================================
-- RONDA 11c · Z9 — Catálogo de estaciones reducido a "Total Energies" + "Otro"
-- ----------------------------------------------------------------------------
-- El negocio surte combustible casi siempre en Total Energies (con la que además
-- hay conciliación T4). Se decide reducir el selector a dos opciones vivas:
--   · "Total Energies" (default)  · "Otro" (texto libre al elegirlo)
-- Las demás estaciones se DESACTIVAN (activo=false), NO se borran: los registros
-- históricos de combustible guardan la estación como TEXTO plano (no FK), así que
-- ningún historial se rompe y la conciliación T4 (default 'Total Energies') queda
-- intacta. Reactivar una estación en el futuro es un simple UPDATE.
-- Aditivo y retrocompatible.
-- ============================================================================

set search_path = sgc, public;

-- Asegurar que las dos opciones vivas existan y estén activas, con el orden correcto.
insert into sgc.estaciones_combustible (nombre, orden, activo)
values ('Total Energies', 1, true)
on conflict (nombre) do update set orden = excluded.orden, activo = true;

insert into sgc.estaciones_combustible (nombre, orden, activo)
values ('Otro', 99, true)
on conflict (nombre) do update set orden = excluded.orden, activo = true;

-- Desactivar todas las demás (Shell, Esso, Sunix, United, Texaco, …) sin borrarlas.
update sgc.estaciones_combustible
   set activo = false
 where nombre not in ('Total Energies', 'Otro')
   and activo = true;

-- Verificación (informativo en logs de aplicación):
--   select nombre, orden, activo from sgc.estaciones_combustible order by orden;
