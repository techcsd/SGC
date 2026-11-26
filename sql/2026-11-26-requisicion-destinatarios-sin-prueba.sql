-- HOTFIX 26-nov-2026: Raykler (almacen) no recibe los correos de requisiciones. Causa raiz: Resend agoto la cuota MENSUAL
-- (592 correos 'resend:cuota_mensual' desde el 25-nov). Cada evento de requisicion mandaba correo a ~38 personas, ~19 de ellas
-- cuentas QA (qa_*@...) y usuarios es_prueba que no leen ese correo. Se excluyen del CORREO (push e in-app no cambian).
-- No arregla la cuota por si solo: reduce el consumo a la mitad; el plan de Resend debe subirse o esperar al reinicio mensual.
-- Reversa: sql/_reversa/2026-11-26-requisicion-destinatarios-sin-prueba.reversa.sql
begin;
set local lock_timeout = '3s';

create or replace function sgc.usuarios_destinatarios_requisicion()
returns table(email text, nombre text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  -- Modulo inventario (incluye admin via 'admin' = any(modulos)) + logistica.
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo
    and u.email is not null
    and not coalesce(u.es_prueba, false)
    and u.email not like 'qa\_%' and u.email not like '%.local'
    and ('inventario' = any(r.modulos) or 'admin' = any(r.modulos))
  union
  -- Roles de proyecto que gestionan requisiciones (bandeja global).
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where u.activo
    and u.email is not null
    and not coalesce(u.es_prueba, false)
    and u.email not like 'qa\_%' and u.email not like '%.local'
    and r.codigo in ('gerente_produccion', 'gerente_proyectos', 'jefe_ingenieros');
$function$;

commit;
