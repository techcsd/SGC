-- ============================================================================
-- CR1 FASE 5 — hallazgo de seguridad (no planeado, encontrado auditando "claves
-- y secretos" para el conector de Claude): sgc.get_resend_api_key() en DEV tenía
-- `GRANT EXECUTE ... TO PUBLIC` — cualquiera, SIN autenticarse (anon), podía
-- pedir la API key real de Resend por REST (`/rest/v1/rpc/get_resend_api_key`).
-- Verificado hoy con una llamada anónima real contra dev: devolvió el secreto.
--
-- **Prod NO tiene este problema** (verificado por separado, solo `postgres` +
-- `service_role`) — es una desviación de DEV únicamente, probablemente de como
-- se clonó el esquema (PROMPT-58). Los ÚNICOS llamadores reales son edge
-- functions con SUPABASE_SERVICE_ROLE_KEY (grep: check-domains, check-
-- subscriptions, generar-informe-obra, incentivo-diario/semanal, notificar-*,
-- resumen-semanal-operaciones) — ninguno necesita el grant público.
--
-- Esta migración deja dev IGUAL a prod (nunca al revés — regla 19).
-- ============================================================================
begin;

revoke execute on function sgc.get_resend_api_key() from public, anon, authenticated;

commit;
