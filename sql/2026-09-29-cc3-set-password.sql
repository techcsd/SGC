-- ============================================================================
-- CC3 (PROMPT-74 F2.5) — El admin fija la contraseña de un usuario + cierre del
-- panel QA del login. Nota #86 (los QA no tienen buzón para el reset).
-- ----------------------------------------------------------------------------
-- Esta migración va a DEV y a PROD (aditiva). La lista blanca de dev + el hook
-- del token viven en cc2-dev-acceso.sql (DEV ONLY).
--
-- 1) usuarios.debe_cambiar_password — al fijar un admin la contraseña de una
--    cuenta REAL, el usuario debe cambiarla al entrar (nadie queda conociendo la
--    contraseña de otro). El guard de sesión manda a /auth/set-password.
-- 2) usuarios_qa_dev() — CC2: deja de ser pre-auth (revoke a anon) y se gatea con
--    is_admin() DENTRO. Ya no alimenta el login (el panel se quita); solo
--    Admin › Usuarios de prueba (admin, y solo en dev por el gate de entorno).
--
-- BU1 (regla 18): --env dev primero, probar, luego --env prod --yes.
-- ============================================================================

begin;

-- ── 1) Marca "debe cambiar contraseña" (aditiva) ─────────────────────────────
alter table sgc.usuarios
  add column if not exists debe_cambiar_password boolean not null default false;

comment on column sgc.usuarios.debe_cambiar_password is
  'CC3 — true cuando un admin fijó la contraseña de esta cuenta real; obliga a '
  'cambiarla en el próximo login (guard → /auth/set-password). Se limpia al cambiarla.';

-- RPC que el usuario llama tras cambiar su contraseña para limpiar la marca.
create or replace function sgc.limpiar_debe_cambiar_password()
returns void
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  update sgc.usuarios set debe_cambiar_password = false where id = auth.uid();
$$;
grant execute on function sgc.limpiar_debe_cambiar_password() to authenticated;

-- ── 2) usuarios_qa_dev(): fuera de anon, gate is_admin() dentro ───────────────
-- Ya no es pre-auth (el login ya no lista cuentas). Solo un admin en dev obtiene
-- la lista (Admin › Usuarios de prueba). En prod, vacío por el gate de entorno.
create or replace function sgc.usuarios_qa_dev()
returns table (email text, nombre text, rol text)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.email, u.nombre,
         coalesce(string_agg(distinct r.nombre, ', ' order by r.nombre), '—') as rol
    from sgc.usuarios u
    left join sgc.usuarios_roles ur on ur.usuario_id = u.id
    left join sgc.roles r on r.id = ur.rol_id
   where (select valor from sgc.config_entorno where clave = 'entorno') = 'dev'  -- solo dev
     and sgc.is_admin()                                                          -- CC2: solo admin
     and coalesce(u.activo, true)
     and u.email is not null
     and (u.email ilike 'qa\_%' escape '\' or coalesce(u.es_prueba, false))
   group by u.email, u.nombre
   order by u.nombre;
$$;

revoke execute on function sgc.usuarios_qa_dev() from anon;
grant execute on function sgc.usuarios_qa_dev() to authenticated, service_role;

comment on function sgc.usuarios_qa_dev() is
  'CC2 — cuentas QA por rol para Admin › Usuarios de prueba (solo admin, solo dev). '
  'Ya NO es pre-auth: revocado a anon (el login dejó de listar cuentas).';

commit;
