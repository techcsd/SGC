-- Reversa de EA1b: re-aplicar la versión previa de que_puedo_consultar().
-- node scripts/apply-migration.mjs sql/2026-11-10-dm4b-que-puedo-consultar.sql --env <env>
-- (Este archivo no repite el cuerpo: el cuerpo previo vive íntegro en esa migración.)
select 1;
