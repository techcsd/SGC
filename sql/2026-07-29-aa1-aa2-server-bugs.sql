-- ============================================================================
-- PROMPT-9 · FASE 1 — Bugs server-side (AA1, AA2)
-- Fecha: 2026-07-29
-- Aditivo / idempotente / retrocompatible.
--
-- AA1 — report_app_error: el outbox de la app v1.34.0 se llenaba de error_reports
--   rechazados. Causa raíz (confirmada contra prod): coexistían DOS overloads del
--   RPC — el de 9 args (Y6, sin p_source) y el de 10 args (Z28, con p_source). La
--   app v1.34.0 envía el payload de 9 parámetros (sin p_source); ese set casa con
--   AMBOS candidatos, así que PostgREST no puede desambiguar y responde
--   PGRST203 / HTTP 300 ("Could not choose the best candidate function"). La app
--   clasifica ese fallo como permanente ("posible desajuste de versión") y el
--   reporte queda atascado. La web funciona porque manda los 10 parámetros.
--   Evidencia: 0 filas de origen 'app' en app_error_reports, solo 1 de la web.
--   Fix: eliminar el overload corto y dejar UNO SOLO (el de 10 args, con
--   p_source default 'app'), que cubre el contrato viejo de 9 args. Igual para
--   app_error_reports_grupos (mismo landmine: 4 args + 5 args).
--
-- AA2 — conductores: al editar un conductor y cambiar la cédula, el error crudo
--   `conductores_cedula_key` llegaba a la UI. La web YA actualiza por id (PK), así
--   que el choque real es una cédula duplicada de OTRO conductor. Z2 solo puso el
--   mensaje amable en `auto_registrar_conductor` (auto-registro móvil), nunca en
--   el path de edición web. Aquí se agrega un helper server-side que detecta la
--   cédula en uso comparando SOLO DÍGITOS (los datos vienen con y sin guiones), y
--   la web lo usa para un mensaje claro (el sync del email sintético del acceso
--   PIN se maneja en la edge conductor-crear-acceso, modo 'sync-cedula').
-- ============================================================================

-- ── AA1 ──────────────────────────────────────────────────────────────────
-- Elimina los overloads cortos que crean ambigüedad en PostgREST. Los largos
-- (con p_source default) quedan como único contrato y son retrocompatibles.
drop function if exists sgc.report_app_error(text, text, text, jsonb, text, text, text, text, text);

drop function if exists sgc.app_error_reports_grupos(timestamptz, timestamptz, text, integer);

-- ── AA2 ──────────────────────────────────────────────────────────────────
-- ¿La cédula ya está en uso por OTRO conductor? Compara solo dígitos para
-- atrapar variantes con/sin guiones (023-0000000-0 == 02300000000). Devuelve el
-- id del conductor que la usa, o null. SECURITY DEFINER + gated a flota/admin.
create or replace function sgc.conductor_cedula_en_uso(
  p_cedula text,
  p_excluir_id uuid default null
) returns uuid
language sql
security definer
set search_path = sgc, public
stable
as $$
  select c.id
  from sgc.conductores c
  where regexp_replace(coalesce(c.cedula, ''), '\D', '', 'g')
        = regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g')
    and regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g') <> ''
    and (p_excluir_id is null or c.id <> p_excluir_id)
  limit 1;
$$;

grant execute on function sgc.conductor_cedula_en_uso(text, uuid) to authenticated, service_role;

comment on function sgc.conductor_cedula_en_uso(text, uuid) is
  'AA2 — id de otro conductor que ya usa esta cédula (comparando solo dígitos), o null. Para validación amable de duplicado en el form web/app.';
