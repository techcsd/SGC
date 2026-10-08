-- 2026-10-08-ck8-directorio-roles-codigos.sql
-- CK8 — `directorio_usuarios_detalle()` ahora también devuelve `roles_codigos text[]`
-- (los CÓDIGOS de rol, además de los nombres visibles). El user-picker filtra por
-- código (`filterRoles=['chofer_privado']`) y hoy comparaba contra los NOMBRES → lista
-- vacía al autorizar un chofer privado. Aditivo: solo se agrega una columna al final;
-- los consumidores JS que leen `roles`/`id`/`nombre` siguen igual.
-- Como cambia el tipo de retorno (TABLE), hay que drop+create en la misma transacción.
--   node scripts/apply-migration.mjs sql/2026-10-08-ck8-directorio-roles-codigos.sql --env dev

begin;

drop function if exists sgc.directorio_usuarios_detalle();

create function sgc.directorio_usuarios_detalle()
returns table(
  id uuid, nombre text, email text, avatar_path text, activo boolean,
  roles text[], roles_codigos text[])
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre::text, u.email::text, u.avatar_path, u.activo,
         coalesce(
           (select array_agg(r.nombre order by r.nombre)
              from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
             where ur.usuario_id = u.id),
           array[]::text[]) as roles,
         coalesce(
           (select array_agg(r.codigo order by r.codigo)
              from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
             where ur.usuario_id = u.id),
           array[]::text[]) as roles_codigos
  from sgc.usuarios u
  where coalesce(u.activo, true)
  order by u.nombre;
$function$;

grant execute on function sgc.directorio_usuarios_detalle() to authenticated, service_role, postgres, public;

commit;
