-- ============================================================================
-- 2026-07-21 — RPC security-definer para registrar documentos desde la app.
-- ----------------------------------------------------------------------------
-- La subida de documentos (cédula/licencia) era el ÚNICO write de la app que
-- insertaba DIRECTO en la tabla (sujeto a RLS) en vez de pasar por un RPC
-- `security definer` como TODOS los demás (regla madre del proyecto). Eso la hacía
-- frágil ("new row violates row-level security policy"). Este RPC la alinea:
-- corre como owner (bypassa la RLS de la tabla), exige sesión y módulo flota/admin
-- —igual que registrar_entrada_app / registrar_salida_app— e inserta idempotente.
-- La FOTO se sigue subiendo al bucket `flota-documentos` desde el cliente (ya
-- alineado a los demás buckets de campo en la migración anterior).
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.registrar_documento_app(
  p_id uuid,
  p_entidad text,
  p_entidad_id uuid,
  p_tipo text,
  p_nombre text,
  p_path text
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  -- Idempotente por el UUID de cliente (mismo id reusado = no duplica).
  insert into sgc.documentos (id, entidad, entidad_id, tipo, nombre, path, subido_por)
  values (p_id, p_entidad, p_entidad_id, p_tipo, nullif(p_nombre, ''), p_path, auth.uid())
  on conflict (id) do nothing;
  return p_id;
end;
$$;

grant execute on function sgc.registrar_documento_app(uuid, text, uuid, text, text, text)
  to authenticated, service_role;
