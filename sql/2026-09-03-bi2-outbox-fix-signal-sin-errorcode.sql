-- =============================================================================
-- PROMPT-32 (BI2) — La señal de "fix publicado" deja de depender de error_code.
-- Ronda 03/09/2026. Aditivo, idempotente, retrocompatible.
--
-- PROBLEMA (verificado): el consumidor de la señal hacía
--   (it.error_code ?? '').startsWith(f.error_code)
-- y el error_code de los registros atascados está VACÍO y siempre lo estará:
--   · el campo nació en la app 2.10.0; los registros son de agosto (más viejos),
--   · y cuando vuelven a fallar, el que falla es Storage — StorageApiError NO trae
--     `code`, sólo status/statusCode.
-- ⇒ '' .startsWith('42501') = false → la señal era estructuralmente inalcanzable.
--
-- SOLUCIÓN: una sola fuente de verdad server-side para el matching (AU1). La regla:
--   · tipo_op:  el fix aplica si fix.tipo_op es null (todos) o coincide con el del item.
--   · versión:  el fix aplica si fix.min_app_version es null o app_version >= min.
--   · error_code: FILTRO OPCIONAL — sólo estrecha cuando el ITEM trae error_code.
--     Si el item no lo trae (vacío/null), el error_code del fix NO bloquea.
-- La app (PROMPT-33) llama a este RPC en vez de comparar error_code en el cliente.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-09-03-bi2-outbox-fix-signal-sin-errorcode.sql
-- =============================================================================
begin;

-- Devuelve el fix activo que aplica a un pendiente del outbox (o 0 filas si ninguno).
-- Ordena por especificidad (tipo_op no-null primero) y recencia.
create or replace function sgc.outbox_fix_para(
  p_tipo_op text,
  p_error_code text default null,
  p_app_version text default null
) returns table (
  id uuid, tipo_op text, error_code text, min_app_version text,
  descripcion text, publicado_en timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select f.id, f.tipo_op, f.error_code, f.min_app_version, f.descripcion, f.publicado_en
  from sgc.outbox_fix_publicado f
  where f.activo
    -- tipo_op: null = aplica a todos
    and (f.tipo_op is null or f.tipo_op = p_tipo_op)
    -- versión mínima: null = cualquiera; si no, la app debe ser >= (semver)
    and (
      f.min_app_version is null
      or nullif(trim(coalesce(p_app_version,'')),'') is null  -- sin versión conocida → no bloquea
      or sgc.semver_code(p_app_version) >= sgc.semver_code(f.min_app_version)
    )
    -- error_code: OPCIONAL. Sólo estrecha cuando el ITEM trae error_code no vacío.
    and (
      f.error_code is null
      or nullif(trim(coalesce(p_error_code,'')),'') is null   -- item sin error_code → no bloquea
      or p_error_code like f.error_code || '%'
    )
  order by (f.tipo_op is not null) desc, f.publicado_en desc
  limit 5;
$$;
grant execute on function sgc.outbox_fix_para(text, text, text) to authenticated, service_role;

commit;
