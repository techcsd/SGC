-- DH10 — Empresa necesita poder subir el logo de verdad (hoy el preview dice
-- "LOGO" en texto, aunque `sgc.empresa.logo_path` ya existe). Reutiliza el bucket
-- público `sgc-avatars` (ya servido sin firma) bajo el prefijo `empresa/`, con
-- escritura solo para admin (no es un dato de un usuario, es de toda la empresa).

create policy "sgc-avatars: admin upload empresa"
  on storage.objects for insert
  with check (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin());

create policy "sgc-avatars: admin update empresa"
  on storage.objects for update
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin())
  with check (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin());

create policy "sgc-avatars: admin delete empresa"
  on storage.objects for delete
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin());
