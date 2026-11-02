-- ════════════════════════════════════════════════════════════════════════════
-- Agente Escriba — sgc.snap_cache: RLS activado sin ninguna policy (hallazgo del Auditor)
-- ════════════════════════════════════════════════════════════════════════════
-- Tabla: sgc.snap_cache (AV7, sql/2026-08-20-av7-map-matching-cache.sql) — caché de
-- map-matching (Google Roads snapToRoads) por hash de contenido del tramo.
--
-- Diagnóstico: el estado actual NO es un bug funcional. La tabla es
-- deliberadamente de "nadie la lee directo": el diseño original (AV7) dice
-- "Sólo la edge function (service_role) lee/escribe; el frontend consume vía la
-- edge", y solo se otorgó `select, insert` a service_role (ni anon ni
-- authenticated tienen grant). service_role tiene BYPASSRLS, así que la edge
-- `supabase/functions/snap-to-roads` funciona hoy igual con o sin policy.
--
-- Por qué esta policy específica: NO se abre a `authenticated` ni a `anon`
-- (sería inventar un acceso que el diseño no necesita — el front nunca la
-- consulta). Solo se deja EXPLÍCITA la intención "cerrada a todos salvo
-- service_role" con una policy restringida a service_role, para que:
--   1) la intención quede documentada en el catálogo (pg_policies), y
--   2) el Auditor (`sgc.agente_auditor_rls_sin_policy()`) deje de reportarla
--      como falso positivo.
-- Los grants NO cambian: authenticated/anon siguen sin acceso alguno.
--
-- Patrón imitado: `odoo_v1_backend` en sql/20261016112524_odoo_identity_fields.sql
-- (tablas backend-only odoo_instancias/odoo_companias: RLS on + grants solo a
-- service_role + `create policy ... for all to service_role using (true) with
-- check (true)`, creada de forma idempotente con `if not exists` sobre pg_policy).
-- Nombre de policy al estilo de la tabla hermana sgc.geocode_cache
-- ("geocode_cache: read auth", sql/2026-08-19-au5-au7-trayectoria-paradas-offline.sql).
--
-- Aditivo e idempotente: sin DROP, sin ALTER destructivo.
-- Aplicar por el flujo normal: --env dev primero, luego prod (regla 18 / BU1).
-- ════════════════════════════════════════════════════════════════════════════

do $snap_cache_policy$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = to_regclass('sgc.snap_cache')
      and polname = 'snap_cache: service_role only'
  ) then
    create policy "snap_cache: service_role only" on sgc.snap_cache
      for all to service_role
      using (true) with check (true);
  end if;
end;
$snap_cache_policy$;

comment on policy "snap_cache: service_role only" on sgc.snap_cache is
  'Tabla backend-only (AV7): solo la edge snap-to-roads (service_role) lee/escribe. Cerrada a anon/authenticated por diseño (sin grants).';
