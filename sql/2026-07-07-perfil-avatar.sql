-- Profile section: users can upload their own avatar, but NOT change their name
-- or email (those stay admin-managed). Avatar lives in a public bucket so the
-- shell can render it via a plain public URL; the only self-write path is a
-- SECURITY DEFINER RPC that sets avatar_path for auth.uid() and nothing else —
-- so opening this doesn't let a user edit nombre/email on their own row.

alter table sgc.usuarios add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sgc-avatars', 'sgc-avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Public read is implicit for a public bucket. Writes are scoped to the user's
-- own folder (path = `${auth.uid()}/…`).
drop policy if exists "sgc-avatars: owner upload" on storage.objects;
drop policy if exists "sgc-avatars: owner update" on storage.objects;
drop policy if exists "sgc-avatars: owner delete" on storage.objects;
create policy "sgc-avatars: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sgc-avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "sgc-avatars: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sgc-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function sgc.actualizar_mi_avatar(p_path text)
returns void
language sql
security definer
set search_path = sgc
as $$
  update sgc.usuarios set avatar_path = p_path, updated_at = now() where id = auth.uid();
$$;
revoke all on function sgc.actualizar_mi_avatar(text) from public;
grant execute on function sgc.actualizar_mi_avatar(text) to authenticated;
