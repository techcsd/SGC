-- ============================================================================
-- W1 — Diagnóstico y fix del reporte atascado de "papo"
-- ----------------------------------------------------------------------------
-- CAUSA RAÍZ (confirmada en logs de prod + código):
--   La app móvil (`reportar.ts`) manda tipo ∈ {'error','mejora','duda'} y el RPC
--   `crear_reporte_app` incluso hace default a 'error'. Pero la tabla
--   `sgc.reportes_usuario` tiene el CHECK `reportes_usuario_tipo_check` que solo
--   admite {'comentario','bug','sugerencia'} (vocabulario del módulo web).
--   => cada reporte desde la app revienta con SQLSTATE 23514 (CHECK violation).
--   El clasificador del outbox de la app hace `/^23/ -> 'referencia'`, así que el
--   23514 se muestra como "Hace referencia a algo que ya no existe o está
--   duplicado" — el mensaje engañoso que vio papo. (Logs 2026-07-22 20:20/20:45.)
--
-- FIX (lado padre = SGC, aditivo y retrocompatible, sin actualizar la app):
--   Normalizamos `p_tipo` DENTRO del RPC al vocabulario canónico del web
--   (comentario/bug/sugerencia). Así:
--     - la app v1.x en prod empieza a funcionar sin actualizarse;
--     - la BD mantiene UN solo vocabulario limpio (sin drift);
--     - la UI admin web no necesita etiquetas nuevas.
--   Mapeo: error→bug, mejora→sugerencia, duda→comentario. Cualquier valor
--   desconocido cae a 'comentario' (nunca más rechazamos un reporte por el tipo).
--
-- Idempotente. `create or replace` conserva la firma exacta (5 args).
-- ============================================================================

create or replace function sgc.crear_reporte_app(
  p_id uuid,
  p_tipo text,
  p_asunto text,
  p_descripcion text,
  p_fotos jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  -- Normaliza el vocabulario de la app al canónico del web. El CHECK
  -- `reportes_usuario_tipo_check` solo admite comentario/bug/sugerencia.
  v_tipo text := case lower(coalesce(nullif(btrim(p_tipo), ''), 'comentario'))
    when 'error'      then 'bug'
    when 'bug'        then 'bug'
    when 'mejora'     then 'sugerencia'
    when 'sugerencia' then 'sugerencia'
    when 'duda'       then 'comentario'
    when 'comentario' then 'comentario'
    else 'comentario' -- cualquier otro valor: nunca rechazar un reporte por el tipo
  end;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if exists (select 1 from sgc.reportes_usuario where id = p_id) then return p_id; end if;

  insert into sgc.reportes_usuario (id, usuario_id, tipo, asunto, descripcion, estado)
  values (p_id, auth.uid(), v_tipo,
          coalesce(nullif(p_asunto, ''), 'Reporte desde la app'), p_descripcion, 'abierto');

  insert into sgc.reportes_usuario_fotos (reporte_id, storage_path)
  select p_id, f->>'storage_path'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f
  where nullif(f->>'storage_path', '') is not null;

  return p_id;
end;
$function$;
