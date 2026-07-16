-- ============================================================================
-- Actualización 7 — B4 (U3): usuarios vinculables CON cédula y teléfono
-- ----------------------------------------------------------------------------
-- El form de conductor autollena datos al enlazar un usuario. `usuarios` solo
-- tiene nombre/email; la cédula/teléfono viven en `empleados`. Los gestores de
-- Flota normalmente NO tienen el módulo RRHH, así que un SELECT directo a
-- `empleados` desde el cliente los bloquea por RLS. Este RPC SECURITY DEFINER
-- devuelve solo (nombre, cédula, teléfono) de usuarios activos, gated a los roles
-- que gestionan conductores (flota/rrhh/admin). Aditivo.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.usuarios_vinculables()
returns table (id uuid, nombre text, cedula text, telefono text, email text)
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre, e.cedula, e.telefono, u.email
  from sgc.usuarios u
  left join lateral (
    select emp.cedula, emp.telefono
    from sgc.empleados emp
    where emp.usuario_id = u.id
       or (emp.email is not null and lower(emp.email) = lower(u.email))
    order by (emp.usuario_id = u.id) desc nulls last
    limit 1
  ) e on true
  where u.activo = true
    and (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.tiene_modulo('rrhh'))
  order by u.nombre;
$function$;

grant execute on function sgc.usuarios_vinculables() to authenticated;
