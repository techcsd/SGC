-- The Resend API key is stored in Supabase Vault (encrypted at rest in
-- Postgres), NOT as a plain Edge Function env var — this repo has no
-- secrets-management tool available, so this is how it was set instead.
-- The actual `vault.create_secret(...)` call (containing the real key) was
-- run as a one-off query, never committed to any file — only this wrapper
-- function is checked in.
--
-- Restricted to service_role only: neither `authenticated` nor `anon` can
-- call this, so the Angular frontend can never retrieve the key — only the
-- notificar-solicitud Edge Function (which connects with the service_role
-- key) can.
create or replace function sgc.get_resend_api_key()
returns text
language sql
security definer
set search_path = vault, pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
$$;

revoke all on function sgc.get_resend_api_key() from public, anon, authenticated;
grant execute on function sgc.get_resend_api_key() to service_role;
