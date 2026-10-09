-- 2026-10-08-ck5-tutoriales.sql
-- CK5 — bucket privado `tutoriales` para los videos de "cómo hacer" (Dudas / Soporte y
-- ayuda). Lectura por URL firmada (authenticated); escritura solo por el script versionado
-- con service role. Los campos de video (video_path/poster_path/vtt_path/duracion_s/
-- plataforma/version) viven DENTRO de ayuda_contenido.contenido (jsonb) → sin cambio de
-- esquema de la tabla. Aditivo.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck5-tutoriales.sql --env dev

begin;

insert into storage.buckets (id, name, public)
values ('tutoriales', 'tutoriales', false)
on conflict (id) do nothing;

-- Lectura: cualquier usuario autenticado (vía URL firmada de corta vida). Escritura/
-- borrado: nadie por RLS (solo el service role del script de subida, que la salta).
drop policy if exists "tutoriales lee" on storage.objects;
create policy "tutoriales lee" on storage.objects
  for select to authenticated
  using (bucket_id = 'tutoriales');

commit;
