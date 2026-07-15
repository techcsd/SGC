-- ============================================================================
-- Actualización 4 — registrar_version: permitir también service_role
-- ----------------------------------------------------------------------------
-- La revisión gateó registrar_version a is_admin() (bien: ningún usuario normal
-- debe escribir app_versiones). Pero el auto-registro de la versión MÓVIL corre
-- desde el script de release (sin sesión de admin, con la service key). Se añade
-- service_role al gate para ese camino server-side. Sigue bloqueado a usuarios
-- autenticados que no sean admin. Idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.registrar_version(
  p_plataforma text, p_version text, p_notas text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not (sgc.is_admin() or coalesce((select auth.role()), '') = 'service_role') then
    raise exception 'No autorizado.';
  end if;
  if p_plataforma not in ('web', 'movil') then
    raise exception 'plataforma inválida: % (usa web|movil)', p_plataforma;
  end if;
  if coalesce(trim(p_version), '') = '' then
    raise exception 'versión requerida';
  end if;

  insert into sgc.app_versiones (plataforma, version, fecha, notas)
  values (p_plataforma, trim(p_version), current_date, nullif(trim(p_notas), ''))
  on conflict (plataforma, version) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from sgc.app_versiones
     where plataforma = p_plataforma and version = trim(p_version);
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.registrar_version(text, text, text) to authenticated, service_role;
