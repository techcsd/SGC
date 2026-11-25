-- EA4 — logo de Empresa: faltaba política SELECT para `empresa/` en `sgc-avatars`.
-- DH10 (2026-11-03) creó solo insert/update/delete. Storage necesita poder LEER la fila
-- (INSERT…ON CONFLICT, y el re-subir); el front pasa a upsert:false, pero esta política
-- evita el fallo también para clientes viejos. Idempotente (reaplica DH10 si faltaba).
-- Aditivo. Reversa: sql/_reversa/2026-11-24-ea4-empresa-logo-select.reversa.sql

drop policy if exists "sgc-avatars: admin upload empresa" on storage.objects;
create policy "sgc-avatars: admin upload empresa"
  on storage.objects for insert
  with check (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin());

drop policy if exists "sgc-avatars: admin update empresa" on storage.objects;
create policy "sgc-avatars: admin update empresa"
  on storage.objects for update
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin())
  with check (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin());

drop policy if exists "sgc-avatars: admin delete empresa" on storage.objects;
create policy "sgc-avatars: admin delete empresa"
  on storage.objects for delete
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa' and sgc.is_admin());

-- Nueva: lectura de empresa/ (el bucket ya es público por URL; esto solo habilita el SELECT de RLS).
drop policy if exists "sgc-avatars: leer empresa" on storage.objects;
create policy "sgc-avatars: leer empresa"
  on storage.objects for select to authenticated
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = 'empresa');
