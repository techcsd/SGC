-- ============================================================================
-- AY C3 — Conocimiento del sistema para Compa (COMPA-V2 §3-C3).
-- Compa responde "¿cómo funciona X?" buscando en el corpus que YA existe: el
-- módulo Dudas (sgc.ayuda_contenido, JSONB). Tool `buscar_ayuda`.
--
-- Búsqueda tolerante con el wrapper `sgc.f_unaccent` + pg_trgm (word_similarity),
-- mismo enfoque que la búsqueda fuzzy de artículos (AW6). Respeta el gating:
-- solo temas cuyo módulo el usuario tiene (o sin módulo), y solo_admin solo admin.
-- (pgvector/embeddings = upgrade opcional cuando haya API de embeddings.)
-- ============================================================================

begin;
set local search_path = sgc, extensions, public;

create or replace function sgc.buscar_ayuda(p_query text)
returns table (titulo text, tipo text, texto text)
language sql stable security definer
set search_path to 'sgc', 'extensions', 'public', 'pg_temp'
as $$
  with base as (
    select ac.tipo,
      coalesce(ac.contenido->>'titulo', '') as titulo,
      coalesce(ac.contenido->>'titulo', '') || ' ' ||
      coalesce((select string_agg(coalesce(it->>'pregunta','') || ' ' || coalesce(it->>'respuesta',''), ' ')
                from jsonb_array_elements(coalesce(ac.contenido->'items', '[]'::jsonb)) it), '') || ' ' ||
      coalesce((select string_agg(p, ' ')
                from jsonb_array_elements_text(coalesce(ac.contenido->'pasos', '[]'::jsonb)) p), '') as texto
    from sgc.ayuda_contenido ac
    where ac.activo
      and (ac.modulo is null or sgc.is_admin() or sgc.tiene_modulo(ac.modulo))
      and (not ac.solo_admin or sgc.is_admin())
  )
  select b.titulo, b.tipo, left(b.texto, 1800) as texto
  from base b
  where length(trim(coalesce(p_query, ''))) >= 2
    and (
      sgc.f_unaccent(lower(p_query)) <% sgc.f_unaccent(lower(b.texto))
      or sgc.f_unaccent(lower(b.texto)) ilike '%' || sgc.f_unaccent(lower(trim(p_query))) || '%'
    )
  order by word_similarity(sgc.f_unaccent(lower(p_query)), sgc.f_unaccent(lower(b.texto))) desc nulls last
  limit 8;
$$;
grant execute on function sgc.buscar_ayuda(text) to authenticated, service_role;

commit;
