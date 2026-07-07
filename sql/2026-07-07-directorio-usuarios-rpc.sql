-- Shared "company directory" RPC: any authenticated user can fetch the minimal
-- (id, nombre) list of active users. Needed because sgc.usuarios RLS only lets a
-- user read their OWN row (admin reads all) — so a task manager, or anyone
-- starting a chat, otherwise couldn't populate an assignee/recipient picker.
--
-- SECURITY DEFINER so it bypasses the row policies, but it returns only id +
-- nombre (no email/salary/etc.), which is not sensitive inside the company app —
-- this avoids widening the usuarios table grants (see the vault/RPC pattern).
create or replace function sgc.directorio_usuarios()
returns table (id uuid, nombre text)
language sql
security definer
set search_path = sgc
as $$
  select u.id, u.nombre
  from sgc.usuarios u
  where u.activo = true
  order by u.nombre;
$$;

revoke all on function sgc.directorio_usuarios() from public;
grant execute on function sgc.directorio_usuarios() to authenticated;
