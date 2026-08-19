-- ============================================================================
-- PROMPT-25 (AW) — Ronda 21/08/2026.
-- AW6: Búsqueda fuzzy de materiales — tolera errores de tipeo, acentos y orden
--      de palabras; matchea nombre, código, categoría y subgrupo; ranking por
--      relevancia; índice GIN trigram para rendimiento con el catálogo completo.
--      RPC reutilizable por la web (picker + "¿Quisiste decir…?") y la app.
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-21-aw6-busqueda-fuzzy-articulos.sql
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Wrapper IMMUTABLE de unaccent (la forma de 2 args es inmutable → indexable).
create or replace function sgc.f_unaccent(p text)
returns text
language sql immutable strict
set search_path = extensions, public, pg_temp
as $$ select unaccent('unaccent', p) $$;
grant execute on function sgc.f_unaccent(text) to authenticated, service_role;

-- Índice trigram sobre el nombre normalizado (acentos fuera, minúsculas).
create index if not exists idx_articulos_nombre_trgm
  on sgc.articulos using gin (sgc.f_unaccent(lower(nombre)) extensions.gin_trgm_ops);

-- RPC de búsqueda. SECURITY INVOKER → respeta la RLS de articulos (visibilidad).
create or replace function sgc.buscar_articulos(p_query text, p_limit int default 20)
returns table (
  id uuid, codigo text, nombre text, categoria_id int, categoria text,
  subgrupo text, unidad text, propiedad text, score real)
language sql stable
set search_path = sgc, extensions, public
as $$
  with q as (select sgc.f_unaccent(lower(trim(coalesce(p_query, '')))) as qn)
  select a.id, a.codigo::text, a.nombre::text, a.categoria_id,
         c.nombre::text as categoria, a.subgrupo, a.unidad::text, a.propiedad,
         greatest(
           similarity(sgc.f_unaccent(lower(a.nombre)), (select qn from q)),
           word_similarity((select qn from q), sgc.f_unaccent(lower(a.nombre))),
           case when sgc.f_unaccent(lower(a.nombre)) like '%' || (select qn from q) || '%' then 0.85 else 0 end,
           case when sgc.f_unaccent(lower(coalesce(a.codigo, ''))) like '%' || (select qn from q) || '%' then 0.9 else 0 end,
           case when sgc.f_unaccent(lower(coalesce(c.nombre, ''))) like '%' || (select qn from q) || '%' then 0.5 else 0 end,
           case when sgc.f_unaccent(lower(coalesce(a.subgrupo, ''))) like '%' || (select qn from q) || '%' then 0.4 else 0 end
         )::real as score
  from sgc.articulos a
  left join sgc.categorias_inventario c on c.id = a.categoria_id
  where a.activo
    and coalesce(a.es_prueba, false) = false
    and (select qn from q) <> ''
    and (
      sgc.f_unaccent(lower(a.nombre)) % (select qn from q)
      or word_similarity((select qn from q), sgc.f_unaccent(lower(a.nombre))) > 0.35
      or sgc.f_unaccent(lower(a.nombre)) like '%' || (select qn from q) || '%'
      or sgc.f_unaccent(lower(coalesce(a.codigo, ''))) like '%' || (select qn from q) || '%'
      or sgc.f_unaccent(lower(coalesce(c.nombre, ''))) like '%' || (select qn from q) || '%'
      or sgc.f_unaccent(lower(coalesce(a.subgrupo, ''))) like '%' || (select qn from q) || '%'
    )
  order by score desc, a.nombre
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
grant execute on function sgc.buscar_articulos(text, int) to authenticated, service_role;
comment on function sgc.buscar_articulos(text, int) is
  'AW6 — búsqueda fuzzy de artículos (pg_trgm + unaccent): tolera tipeo/acentos/orden; matchea nombre/código/categoría/subgrupo con ranking. Usada por el picker web y la app.';
