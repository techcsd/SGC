-- DN-28 (ronda DN, continuación) — bug real: sgc.puede_rrhh_sensible() y
-- puede_operar_rrhh_sensible() usaban el código de rol 'rrhh' como fallback
-- ("Solo RRHH + Gerencia"), pero ESE código de rol no existe -- el rol real
-- es 'jefe_rrhh' ("Jefe de RRHH", id 5). Con el bug, nadie (ni siquiera
-- jefe_rrhh) podía ver Contratos/Nómina/Evaluaciones sin permisos
-- granulares explícitos. Corrige el código, sin tocar el resto del diseño
-- (sigue sin bypass de is_admin() ni de módulo padre).
begin;

create or replace function sgc.puede_rrhh_sensible(p_key text)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid()
      and coalesce(r.permisos->>p_key,'') in ('ver','operar')
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('jefe_rrhh','gerencia','direccion')
  );
$function$;

create or replace function sgc.puede_operar_rrhh_sensible(p_key text)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and coalesce(r.permisos->>p_key,'') = 'operar'
  ) or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo in ('jefe_rrhh','gerencia','direccion')
  );
$function$;

commit;
