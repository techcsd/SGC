-- AU12 — Apodos / alias de artículos. El mejor costo/beneficio de la ronda:
-- la obra pide "panel de 24" y no encuentra "[CSD] PANEL FILLER 24\"X8' (61X244CM) CSD".
-- Con apodos, el buscador (y el matching automático de requisiciones AT7) resuelven
-- por el nombre no oficial. Varios apodos por artículo, editables desde web/app según
-- permiso, con traza de quién lo agregó.
-- Aditivo / idempotente / retrocompatible.

create extension if not exists pg_trgm with schema extensions;

-- ── Tabla de apodos ──────────────────────────────────────────────────────────
create table if not exists sgc.articulo_alias (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references sgc.articulos(id) on delete cascade,
  alias       text not null,
  alias_norm  text not null,
  creado_por  uuid references sgc.usuarios(id),
  created_at  timestamptz not null default now()
);
-- Un mismo apodo (normalizado) no se repite por artículo.
create unique index if not exists uq_articulo_alias_norm on sgc.articulo_alias(articulo_id, alias_norm);
create index if not exists idx_articulo_alias_art on sgc.articulo_alias(articulo_id);
create index if not exists idx_articulo_alias_norm_trgm
  on sgc.articulo_alias using gin (alias_norm extensions.gin_trgm_ops);

alter table sgc.articulo_alias enable row level security;
grant select on sgc.articulo_alias to authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sgc' and tablename='articulo_alias' and policyname='articulo_alias_sel') then
    create policy articulo_alias_sel on sgc.articulo_alias for select to authenticated using (true);
  end if;
end $$;

-- ── Normalización de apodos/búsqueda: unaccent + minúsculas + colapsa espacios +
--    quita comillas de pulgadas. Consistente entre lo almacenado y la query. ──────
create or replace function sgc.normalizar_alias(p text)
returns text language sql immutable
set search_path = sgc, extensions, public, pg_temp
as $$
  select sgc.f_unaccent(lower(btrim(
           regexp_replace(regexp_replace(coalesce(p, ''), '["'']', '', 'g'), '\s+', ' ', 'g')
         )))
$$;
grant execute on function sgc.normalizar_alias(text) to authenticated, service_role;

-- ── RPCs de gestión de apodos (SECURITY DEFINER; gate admin/inventario) ────────
create or replace function sgc.articulo_alias_listar(p_articulo_id uuid)
returns table(id uuid, alias text, creado_por uuid, creador text, created_at timestamptz)
language sql stable security definer set search_path = sgc, public, pg_temp
as $$
  select aa.id, aa.alias, aa.creado_por, u.nombre::text, aa.created_at
  from sgc.articulo_alias aa
  left join sgc.usuarios u on u.id = aa.creado_por
  where aa.articulo_id = p_articulo_id
  order by aa.created_at;
$$;
grant execute on function sgc.articulo_alias_listar(uuid) to authenticated, service_role;

create or replace function sgc.articulo_alias_agregar(p_articulo_id uuid, p_alias text)
returns uuid language plpgsql security definer set search_path = sgc, public, pg_temp
as $$
declare v_id uuid; v_norm text;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No tienes permiso para agregar apodos.' using errcode = '42501';
  end if;
  v_norm := sgc.normalizar_alias(p_alias);
  if coalesce(v_norm, '') = '' then
    raise exception 'El apodo no puede estar vacío.' using errcode = 'AU400';
  end if;
  insert into sgc.articulo_alias(articulo_id, alias, alias_norm, creado_por)
    values (p_articulo_id, btrim(p_alias), v_norm, auth.uid())
  on conflict (articulo_id, alias_norm) do update set alias = excluded.alias
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.articulo_alias_agregar(uuid, text) to authenticated, service_role;

create or replace function sgc.articulo_alias_eliminar(p_id uuid)
returns void language plpgsql security definer set search_path = sgc, public, pg_temp
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No tienes permiso para eliminar apodos.' using errcode = '42501';
  end if;
  delete from sgc.articulo_alias where id = p_id;
end;
$$;
grant execute on function sgc.articulo_alias_eliminar(uuid) to authenticated, service_role;

-- ── buscar_articulos: ahora también matchea APODOS y dice POR QUÉ coincidió ─────
-- Cambia la firma (agrega match_por / match_alias) → DROP + CREATE + re-grant.
drop function if exists sgc.buscar_articulos(text, int);
create function sgc.buscar_articulos(p_query text, p_limit int default 20)
returns table (
  id uuid, codigo text, nombre text, categoria_id int, categoria text,
  subgrupo text, unidad text, propiedad text, score real,
  match_por text, match_alias text)
language sql stable
set search_path = sgc, extensions, public
as $$
  with q as (select sgc.normalizar_alias(p_query) as qn)
  select a.id, a.codigo::text, a.nombre::text, a.categoria_id,
         c.nombre::text as categoria, a.subgrupo, a.unidad::text, a.propiedad,
         greatest(
           similarity(sgc.f_unaccent(lower(a.nombre)), (select qn from q)),
           word_similarity((select qn from q), sgc.f_unaccent(lower(a.nombre))),
           case when sgc.f_unaccent(lower(a.nombre)) like '%' || (select qn from q) || '%' then 0.85 else 0 end,
           case when sgc.f_unaccent(lower(coalesce(a.codigo, ''))) like '%' || (select qn from q) || '%' then 0.9 else 0 end,
           case when sgc.f_unaccent(lower(coalesce(c.nombre, ''))) like '%' || (select qn from q) || '%' then 0.5 else 0 end,
           case when sgc.f_unaccent(lower(coalesce(a.subgrupo, ''))) like '%' || (select qn from q) || '%' then 0.4 else 0 end,
           coalesce(al.alias_score, 0)
         )::real as score,
         -- Por qué coincidió (prioriza apodo cuando fue el más fuerte).
         case
           when al.alias_text is not null
                and coalesce(al.alias_score, 0) >= similarity(sgc.f_unaccent(lower(a.nombre)), (select qn from q))
                and coalesce(al.alias_score, 0) >= (case when sgc.f_unaccent(lower(a.nombre)) like '%' || (select qn from q) || '%' then 0.85 else 0 end)
             then 'apodo'
           when sgc.f_unaccent(lower(coalesce(a.codigo, ''))) like '%' || (select qn from q) || '%' then 'codigo'
           when sgc.f_unaccent(lower(coalesce(c.nombre, ''))) like '%' || (select qn from q) || '%' then 'categoria'
           else 'nombre'
         end as match_por,
         al.alias_text as match_alias
  from sgc.articulos a
  left join sgc.categorias_inventario c on c.id = a.categoria_id
  left join lateral (
    select aa.alias as alias_text,
           greatest(
             similarity(aa.alias_norm, (select qn from q)),
             case when aa.alias_norm like '%' || (select qn from q) || '%' then 0.88 else 0 end
           ) as alias_score
    from sgc.articulo_alias aa
    where aa.articulo_id = a.id
      and (select qn from q) <> ''
      and (aa.alias_norm % (select qn from q) or aa.alias_norm like '%' || (select qn from q) || '%')
    order by alias_score desc
    limit 1
  ) al on true
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
      or al.alias_text is not null
    )
  order by score desc, a.nombre
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
grant execute on function sgc.buscar_articulos(text, int) to authenticated, service_role;
comment on function sgc.buscar_articulos(text, int) is
  'AW6/AU12 — búsqueda fuzzy de artículos (pg_trgm + unaccent) por nombre/código/categoría/subgrupo Y APODOS; devuelve match_por + match_alias para explicar por qué coincidió. Usada por el picker web, la app y el matching de requisiciones (AT7).';
