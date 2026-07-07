-- Fix: profile-pic upload failed with "new row violates row-level security
-- policy". The client uploads with upsert (x-upsert: true) → INSERT ON CONFLICT
-- DO UPDATE, which evaluates the UPDATE policy's WITH CHECK. The original
-- "sgc-avatars: owner update" policy had only USING (no WITH CHECK), so the
-- upserted row failed the check. Recreate it with an explicit WITH CHECK.
drop policy if exists "sgc-avatars: owner update" on storage.objects;
create policy "sgc-avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
