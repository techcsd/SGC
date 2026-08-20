-- AS20 — edición de artículos desde la app (editores: admin + módulo inventario).
-- ADITIVO: bucket PÚBLICO `sgc-articulos` para las imágenes de catálogo (la app ya
-- renderiza `articulos.imagen_url` como URL directa → un bucket público encaja sin
-- cambiar el render) + policies de escritura por rol + RPC de actualización de
-- campos/imagen. No altera tablas, RLS ni RPCs existentes. Ningún artículo tiene
-- imagen hoy, así que no rompe nada de la web (que podrá usar el mismo bucket).

insert into storage.buckets (id, name, public)
values ('sgc-articulos', 'sgc-articulos', true)
on conflict (id) do nothing;

-- Lectura: pública (bucket público). Escritura: admin o módulo inventario.
drop policy if exists "sgc_articulos_insert" on storage.objects;
create policy "sgc_articulos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-articulos' and (sgc.is_admin() or sgc.tiene_modulo('inventario')));

drop policy if exists "sgc_articulos_update" on storage.objects;
create policy "sgc_articulos_update" on storage.objects for update to authenticated
  using (bucket_id = 'sgc-articulos' and (sgc.is_admin() or sgc.tiene_modulo('inventario')))
  with check (bucket_id = 'sgc-articulos' and (sgc.is_admin() or sgc.tiene_modulo('inventario')));

-- Actualiza campos e imagen de un artículo (solo los valores provistos; el resto
-- se conserva). Gate: admin o módulo inventario.
create or replace function sgc.articulo_actualizar_app(
  p_id           uuid,
  p_nombre       text default null,
  p_unidad       text default null,
  p_categoria_id int  default null,
  p_propiedad    text default null,
  p_nota         text default null,
  p_imagen_url   text default null
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para editar artículos' using errcode = '42501';
  end if;

  update sgc.articulos set
    nombre       = coalesce(nullif(trim(p_nombre), ''), nombre),
    unidad       = coalesce(nullif(trim(p_unidad), ''), unidad),
    categoria_id = coalesce(p_categoria_id, categoria_id),
    propiedad    = coalesce(nullif(trim(p_propiedad), ''), propiedad),
    -- nota / imagen: si el parámetro llega null NO se toca; si llega vacío se limpia.
    nota         = case when p_nota is null then nota else nullif(trim(p_nota), '') end,
    imagen_url   = case when p_imagen_url is null then imagen_url else nullif(trim(p_imagen_url), '') end,
    updated_at   = now()
  where id = p_id;

  if not found then
    raise exception 'Artículo no encontrado';
  end if;
end;
$$;

grant execute on function sgc.articulo_actualizar_app(uuid, text, text, int, text, text, text) to authenticated;
