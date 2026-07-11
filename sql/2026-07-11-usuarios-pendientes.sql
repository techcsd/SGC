-- SGC · Flag users who were invited but haven't accepted yet (never signed in),
-- so the admin can see who is "Pendiente" and resend their invitation.
-- SECURITY DEFINER so it can read auth.users; admin-gated.
-- Apply: node ../dev2/csd-app/scripts/apply-migration.mjs sql/2026-07-11-usuarios-pendientes.sql

create or replace function sgc.usuarios_estado_auth()
returns table(id uuid, pendiente boolean, ultimo_acceso timestamptz, invitado_en timestamptz)
language plpgsql
stable
security definer
set search_path = sgc, auth, pg_temp
as $$
begin
  if not sgc.is_admin() then
    raise exception 'No autorizado.';
  end if;
  return query
    select u.id,
           (au.last_sign_in_at is null) as pendiente,
           au.last_sign_in_at,
           au.invited_at
    from sgc.usuarios u
    join auth.users au on au.id = u.id;
end;
$$;

grant execute on function sgc.usuarios_estado_auth() to authenticated;
