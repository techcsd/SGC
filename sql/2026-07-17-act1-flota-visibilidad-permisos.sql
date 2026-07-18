-- ============================================================================
-- Actualización 1 — P6: Flota estado/activo, visibilidad y permisos
-- ----------------------------------------------------------------------------
-- `activo=false` (desactivado) NO lo ven usuarios normales; solo roles elevados
-- (admin, dirección, gerencia, jefe de flota). Solo esos roles pueden crear/
-- editar/activar/desactivar. Fuente de verdad en RLS + helper reutilizable.
-- Aditivo/idempotente. DELETE se mantiene admin-only (destructivo).
-- ============================================================================

set search_path = sgc, public;

-- Helper: rol elevado de flota (espejo de UserService.esFlotaElevado en el front).
create or replace function sgc.es_flota_elevado()
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and r.codigo in ('admin', 'direccion', 'gerencia', 'jefe_flota')
  );
$function$;

grant execute on function sgc.es_flota_elevado() to authenticated;

-- Reemplaza las 2 policies previas ("read"=true / "write"=is_admin) por policies
-- por comando: los inactivos solo para elevados; escritura para elevados.
drop policy if exists "vehiculos: read" on sgc.vehiculos;
drop policy if exists "vehiculos: write" on sgc.vehiculos;
drop policy if exists "vehiculos: select" on sgc.vehiculos;
drop policy if exists "vehiculos: insert" on sgc.vehiculos;
drop policy if exists "vehiculos: update" on sgc.vehiculos;
drop policy if exists "vehiculos: delete" on sgc.vehiculos;

create policy "vehiculos: select" on sgc.vehiculos for select
  using (activo = true or sgc.es_flota_elevado());

create policy "vehiculos: insert" on sgc.vehiculos for insert
  with check (sgc.es_flota_elevado());

create policy "vehiculos: update" on sgc.vehiculos for update
  using (sgc.es_flota_elevado()) with check (sgc.es_flota_elevado());

create policy "vehiculos: delete" on sgc.vehiculos for delete
  using (sgc.is_admin());
