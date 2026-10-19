-- ============================================================================
-- CS2 (4B) — Bucket privado para imágenes pegadas/arrastradas en notas. Ruta
-- `<dueño>/<nota>/<uuid>.png`; la política de Storage reutiliza
-- sgc.puede_ver_nota / sgc.puede_editar_nota (RLS única, ya viva en sgc.notas)
-- en vez de duplicar la lógica de acceso. 5 MB por imagen lo aplica el propio
-- bucket (file_size_limit); el tope de 20 imágenes por nota es UX (aviso claro
-- en el cliente antes de subir) — no hay abuso entre usuarios que proteger
-- (es espacio privado del propio dueño/colaboradores de SU nota).
-- ============================================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('notas-imagenes', 'notas-imagenes', false, 5242880)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ── Helpers: de la ruta `<dueño>/<nota>/<archivo>` → el id de la nota ───────
create or replace function sgc.puede_ver_nota_imagen(p_path text)
 returns boolean
 language sql
 stable
 set search_path to 'sgc', 'pg_temp'
as $function$
  select case
    when (storage.foldername(p_path))[2] is null then false
    else sgc.puede_ver_nota(((storage.foldername(p_path))[2])::uuid, auth.uid())
  end;
$function$;
grant execute on function sgc.puede_ver_nota_imagen(text) to authenticated;

create or replace function sgc.puede_editar_nota_imagen(p_path text)
 returns boolean
 language sql
 stable
 set search_path to 'sgc', 'pg_temp'
as $function$
  select case
    when (storage.foldername(p_path))[2] is null then false
    else sgc.puede_editar_nota(((storage.foldername(p_path))[2])::uuid)
  end;
$function$;
grant execute on function sgc.puede_editar_nota_imagen(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'notas_imagenes_select') then
    create policy notas_imagenes_select on storage.objects
      for select to authenticated
      using (bucket_id = 'notas-imagenes' and sgc.puede_ver_nota_imagen(name));
  end if;
  if not exists (select 1 from pg_policy where polname = 'notas_imagenes_insert') then
    create policy notas_imagenes_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'notas-imagenes' and sgc.puede_editar_nota_imagen(name));
  end if;
  if not exists (select 1 from pg_policy where polname = 'notas_imagenes_delete') then
    create policy notas_imagenes_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'notas-imagenes' and sgc.puede_editar_nota_imagen(name));
  end if;
end
$$;

commit;
