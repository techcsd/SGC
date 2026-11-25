-- Reversa de EA4: quita solo la política nueva (las de DH10 se dejan intactas).
drop policy if exists "sgc-avatars: leer empresa" on storage.objects;
