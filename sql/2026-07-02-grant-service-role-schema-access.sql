-- Fixes "permission denied for schema sgc" from admin-create-user (and
-- would have hit the same wall in admin-deactivate-user,
-- admin-reset-user-password, and notificar-solicitud the moment they
-- touched a table service_role hadn't been explicitly granted).
--
-- sgc is a custom schema — Supabase only auto-wires role grants for
-- schemas it manages by convention (public, etc.). Since nothing used a
-- service_role client against sgc before this session's Edge Functions,
-- service_role had never been granted USAGE on the schema at all, let
-- alone table/function privileges. `authenticated` already had USAGE
-- (that's how the whole app has worked all along); service_role simply
-- never needed it until now.
--
-- This is safe to grant broadly: service_role already bypasses RLS
-- entirely by Supabase's design (it's the platform's dedicated
-- trusted-backend role) and is never exposed to the frontend — every
-- Edge Function using it independently re-verifies the caller is an
-- admin before doing anything privileged. This grant just completes its
-- intended baseline access to this schema, the same way it already has
-- for public/auth/storage.
grant usage on schema sgc to service_role;
grant all on all tables in schema sgc to service_role;
grant all on all sequences in schema sgc to service_role;
grant execute on all functions in schema sgc to service_role;

-- So this doesn't recur for every new table/function added to sgc going forward.
alter default privileges in schema sgc grant all on tables to service_role;
alter default privileges in schema sgc grant all on sequences to service_role;
alter default privileges in schema sgc grant execute on functions to service_role;
