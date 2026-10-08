-- 2026-10-07-ci8-store-urls-param.sql
-- CI1/CI7 — URLs de las fichas de tienda (Google Play / App Store). Vacías hasta
-- que existan; la app las lee para su insignia/actualización y la web las muestra
-- en /app-movil. Aditivo.
--   node scripts/apply-migration.mjs sql/2026-10-07-ci8-store-urls-param.sql --env dev
insert into sgc.parametros (clave, valor, descripcion) values
  ('play_store_url', '', 'CI1 — URL de la ficha de Google Play de la CSD App. Vacío = sin insignia.'),
  ('app_store_url',  '', 'CI1 — URL de la ficha del App Store de la CSD App. Vacío = sin insignia.')
on conflict (clave) do nothing;
