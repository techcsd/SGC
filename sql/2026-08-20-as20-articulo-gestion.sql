-- AS20 (completo) — crear artículos/categorías/unidades + MÚLTIPLES fotos con portada,
-- desde la app (editores: admin + módulo inventario). ADITIVO: tabla nueva
-- articulo_imagenes + RPCs. El código se genera CSD-<orden categoría 2d>-<seq 3d>
-- (misma convención que la web; el prefijo = `orden` de la categoría, verificado).
-- La foto de portada se sincroniza a articulos.imagen_url para que catálogo/detalle/
-- pickers (que leen imagen_url) muestren la portada sin cambios.

-- ── Tabla de imágenes por artículo ──────────────────────────────────────────
create table if not exists sgc.articulo_imagenes (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references sgc.articulos(id) on delete cascade,
  url         text not null,
  portada     boolean not null default false,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_articulo_imagenes_articulo on sgc.articulo_imagenes(articulo_id);
alter table sgc.articulo_imagenes enable row level security;

-- Lectura para cualquier autenticado (catálogo no sensible; el bucket ya es público).
drop policy if exists "articulo_imagenes_select" on sgc.articulo_imagenes;
create policy "articulo_imagenes_select" on sgc.articulo_imagenes for select to authenticated using (true);
-- Escritura solo por los RPCs SECURITY DEFINER (no policies de insert/update/delete).

grant select on sgc.articulo_imagenes to authenticated;

-- ── Helper de gate (admin o módulo inventario) ──────────────────────────────
create or replace function sgc.puede_gestionar_articulos()
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp'
as $$ select sgc.is_admin() or sgc.tiene_modulo('inventario'); $$;
grant execute on function sgc.puede_gestionar_articulos() to authenticated;

-- ── Crear categoría ─────────────────────────────────────────────────────────
create or replace function sgc.crear_categoria_app(p_nombre text, p_destacada boolean default false)
returns int language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id int; v_orden int;
begin
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'Nombre requerido'; end if;
  select coalesce(max(orden),0)+1 into v_orden from sgc.categorias_inventario;
  insert into sgc.categorias_inventario(nombre, orden, destacada, activo)
    values(trim(p_nombre), v_orden, coalesce(p_destacada,false), true)
    returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.crear_categoria_app(text, boolean) to authenticated;

-- ── Crear unidad ─────────────────────────────────────────────────────────────
create or replace function sgc.crear_unidad_app(p_nombre text, p_codigo text default null)
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid; v_cod text;
begin
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'Nombre requerido'; end if;
  v_cod := nullif(trim(coalesce(p_codigo,'')),'');
  if v_cod is null then v_cod := lower(regexp_replace(trim(p_nombre), '\s+', '_', 'g')); end if;
  insert into sgc.unidades(codigo, nombre, activo) values(v_cod, trim(p_nombre), true)
    on conflict (codigo) do update set nombre=excluded.nombre, activo=true
    returning id into v_id;
  return v_id;
end $$;
grant execute on function sgc.crear_unidad_app(text, text) to authenticated;

-- ── Crear artículo (código auto CSD-<orden>-<seq>) ───────────────────────────
create or replace function sgc.crear_articulo_app(
  p_nombre text, p_categoria_id int, p_unidad text default null,
  p_propiedad text default 'propio_csd', p_nota text default null
) returns jsonb language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_orden int; v_prefix text; v_seq int; v_codigo text; v_id uuid;
begin
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then raise exception 'Nombre requerido'; end if;
  select orden into v_orden from sgc.categorias_inventario where id=p_categoria_id;
  if not found then raise exception 'Categoría inválida'; end if;
  v_prefix := 'CSD-'||lpad(v_orden::text,2,'0')||'-';
  select coalesce(max((substring(codigo from '([0-9]+)$'))::int),0)+1 into v_seq
    from sgc.articulos where codigo like v_prefix||'%';
  loop
    v_codigo := v_prefix||lpad(v_seq::text,3,'0');
    exit when not exists(select 1 from sgc.articulos where codigo=v_codigo);
    v_seq := v_seq+1;
  end loop;
  insert into sgc.articulos(nombre, codigo, categoria_id, unidad, propiedad, nota, activo)
    values(trim(p_nombre), v_codigo, p_categoria_id,
           nullif(trim(coalesce(p_unidad,'')),''),
           coalesce(nullif(trim(coalesce(p_propiedad,'')),''),'propio_csd'),
           nullif(trim(coalesce(p_nota,'')),''), true)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end $$;
grant execute on function sgc.crear_articulo_app(text, int, text, text, text) to authenticated;

-- ── Imágenes: agregar / portada / eliminar (sincronizan articulos.imagen_url) ─
create or replace function sgc.articulo_imagen_agregar(p_articulo_id uuid, p_url text, p_portada boolean default false)
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_id uuid; v_es_primera boolean; v_orden int;
begin
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  select count(*)=0 into v_es_primera from sgc.articulo_imagenes where articulo_id=p_articulo_id;
  select coalesce(max(orden),0)+1 into v_orden from sgc.articulo_imagenes where articulo_id=p_articulo_id;
  insert into sgc.articulo_imagenes(articulo_id, url, portada, orden)
    values(p_articulo_id, p_url, (p_portada or v_es_primera), v_orden)
    returning id into v_id;
  if p_portada or v_es_primera then
    update sgc.articulo_imagenes set portada=(id=v_id) where articulo_id=p_articulo_id;
    update sgc.articulos set imagen_url=p_url, updated_at=now() where id=p_articulo_id;
  end if;
  return v_id;
end $$;
grant execute on function sgc.articulo_imagen_agregar(uuid, text, boolean) to authenticated;

create or replace function sgc.articulo_set_portada(p_imagen_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_art uuid; v_url text;
begin
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  select articulo_id, url into v_art, v_url from sgc.articulo_imagenes where id=p_imagen_id;
  if not found then raise exception 'Imagen no encontrada'; end if;
  update sgc.articulo_imagenes set portada=(id=p_imagen_id) where articulo_id=v_art;
  update sgc.articulos set imagen_url=v_url, updated_at=now() where id=v_art;
end $$;
grant execute on function sgc.articulo_set_portada(uuid) to authenticated;

create or replace function sgc.articulo_imagen_eliminar(p_imagen_id uuid)
returns void language plpgsql security definer set search_path to 'sgc','pg_temp'
as $$
declare v_art uuid; v_era_portada boolean; v_nueva_url text;
begin
  if not sgc.puede_gestionar_articulos() then raise exception 'No autorizado' using errcode='42501'; end if;
  select articulo_id, portada into v_art, v_era_portada from sgc.articulo_imagenes where id=p_imagen_id;
  if not found then return; end if;
  delete from sgc.articulo_imagenes where id=p_imagen_id;
  if v_era_portada then
    select url into v_nueva_url from sgc.articulo_imagenes where articulo_id=v_art order by orden limit 1;
    if v_nueva_url is not null then
      update sgc.articulo_imagenes set portada=true where articulo_id=v_art and url=v_nueva_url;
    end if;
    update sgc.articulos set imagen_url=v_nueva_url, updated_at=now() where id=v_art;
  end if;
end $$;
grant execute on function sgc.articulo_imagen_eliminar(uuid) to authenticated;
