-- Helper for the notificar-solicitud Edge Function: given a module key,
-- returns the emails of active users who hold it (admin included). Only
-- ever called by the Edge Function using the service_role key (which
-- bypasses RLS/grants entirely) — deliberately NOT granted to
-- `authenticated`, so a regular session can't use it to enumerate staff
-- emails by module.
create or replace function sgc.usuarios_con_modulo(p_modulo text)
returns table(email text, nombre text)
language sql
stable
as $$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo and (p_modulo = any(r.modulos) or 'admin' = any(r.modulos));
$$;
