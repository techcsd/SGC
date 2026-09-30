-- ============================================================================
-- CD6 (nota #97) — "Historial de versiones": el botón "Abrir esta versión" manda a
-- GitHub. Causa (por diseño, no fallo): gen-version.mjs y registrar-version-web.mjs
-- guardan `url` = commit de GitHub, y el botón la usa. Nunca se guardó la URL del deploy.
--
-- ⚠️ Un deploy viejo de Vercel habla con la BD de prod ACTUAL con código viejo → abrirlo
-- para "mirar" puede escribir con lógica vieja. Por eso el DEFAULT no es abrir el deploy
-- viejo contra prod, sino: (a) guardar deploy_url INMUTABLE; el botón "Abrir esta versión"
-- solo para Tecnología (frontend); el enlace a GitHub se relabela "Ver cambios en el código"
-- (solo Tecnología). La galería de capturas por versión y el preview contra dev quedan
-- como infra de release (docs/REVISION + HANDOFF), fuera de esta migración.
--
-- Esta migración solo añade la columna aditiva. registrar-version-web.mjs la puebla con
-- VERCEL_URL/VERCEL_BRANCH_URL en el build.
--
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd6-historial-deploy-url.sql --env dev  →  --env prod
-- ============================================================================
begin;

alter table sgc.app_versiones add column if not exists deploy_url text;
comment on column sgc.app_versiones.deploy_url is
  'CD6 — URL inmutable del deployment (VERCEL_URL) de esa versión. Distinta de `url` (commit de GitHub). Solo Tecnología abre el deploy antiguo (frontend), y apunta a dev.';

commit;
