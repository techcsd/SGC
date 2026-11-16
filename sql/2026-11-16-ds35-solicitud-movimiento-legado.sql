-- DS-35 (ronda DS, 16-nov-2026) — #59: el módulo de solicitudes de movimiento NO se retira.
-- Dos flags reversibles (apagados por defecto, dependen de entrevistar a Logística):
--   solicitud_movimiento_aviso_legado → banner «las rutas nacen de los conduces» dentro del módulo.
--   solicitud_movimiento_oculta       → oculta la entrada del menú y redirige /transporte/apoyo al conduce.
-- Ambas se leen en la UI por sgc.parametros_ui() (DS-33). Aditiva.
--   node scripts/apply-migration.mjs sql/2026-11-16-ds35-solicitud-movimiento-legado.sql --env dev
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('solicitud_movimiento_aviso_legado', 'false', 'DS-35/#59: muestra un aviso de legado dentro de Apoyo de transporte (las rutas nacen de los conduces).'),
  ('solicitud_movimiento_oculta', 'false', 'DS-35/#59: oculta Apoyo de transporte del menú y redirige al conduce (reversible; no borra datos).')
on conflict (clave) do nothing;
commit;
