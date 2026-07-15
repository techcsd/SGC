-- ============================================================================
-- Actualización 3 — V3/V4: subida de APK (bucket app-releases) + notificación
--   V3: política de ESCRITURA admin sobre el bucket público app-releases para
--       poder subir el APK desde la página admin. (Lectura ya existía.)
--   V4: RPC notificar_todos() para avisar a TODOS los usuarios activos al
--       publicar una versión (centro de notificaciones in-app).
-- Aditivo/retrocompatible. Idempotente.
-- ============================================================================

set search_path = sgc, public;

-- ── V3. Escritura admin en el bucket app-releases (público en lectura) ───────
-- El bucket ya existe y es público (SELECT anon/authenticated). Falta permitir
-- que el admin suba/reemplace/borre objetos.
drop policy if exists app_releases_admin_write on storage.objects;
create policy app_releases_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'app-releases' and sgc.is_admin());

drop policy if exists app_releases_admin_update on storage.objects;
create policy app_releases_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'app-releases' and sgc.is_admin())
  with check (bucket_id = 'app-releases' and sgc.is_admin());

drop policy if exists app_releases_admin_delete on storage.objects;
create policy app_releases_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'app-releases' and sgc.is_admin());

-- ── V4. Notificar a TODOS los usuarios activos (in-app) ──────────────────────
-- Patrón de sgc.notificar_modulo pero sin filtro de módulo. Solo admin la puede
-- invocar (la publicación de versiones es admin-only). Devuelve # de avisos.
create or replace function sgc.notificar_todos(
  p_tipo text, p_titulo text, p_mensaje text, p_ruta text
)
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_n integer;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede notificar a todos los usuarios.';
  end if;
  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  select u.id, coalesce(p_tipo, 'info'), p_titulo, p_mensaje, p_ruta
  from sgc.usuarios u
  where u.activo;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.notificar_todos(text, text, text, text) to authenticated, service_role;
