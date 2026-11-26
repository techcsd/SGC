-- Reversa: vuelve a incluir cuentas QA y es_prueba en los destinatarios de requisiciones.
begin;
create or replace function sgc.usuarios_destinatarios_requisicion()
returns table(email text, nombre text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo
    and u.email is not null
    and ('inventario' = any(r.modulos) or 'admin' = any(r.modulos))
  union
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo
    and u.email is not null
    and r.codigo in ('gerente_produccion', 'gerente_proyectos', 'jefe_ingenieros');
$function$;
commit;
