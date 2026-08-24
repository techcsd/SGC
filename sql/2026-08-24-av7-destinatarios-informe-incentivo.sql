-- =============================================================================
-- PROMPT-7 FASE 2 (AV7) — Destinatarios del "Incentivo semanal de choferes".
-- Ronda 24/08/2026 (IDs AV). Aditivo, idempotente, retrocompatible.
--
-- Problema (verificado en prod): el edge resolvía destinatarios con
-- `usuarios_con_modulo('incentivos')`, cuyo cuerpo tiene `... OR 'admin' = any(modulos)`.
-- Eso, combinado con usuarios multi-rol, hacía que el informe (comparativa de choferes
-- con montos = dato sensible) le llegara a Sonia Castillo (Legal) y a Felipe Scheker,
-- además de a los destinatarios correctos (Eduardo/gerencia, Misael+Raykler/logística,
-- Xaviel/admin).
--
-- Criterio (AV7): SOLO roles elevados + admin, resuelto por ROL (no por correo quemado
-- ni por "módulo admin"). Lista PARAMETRIZADA para ajustar sin código.
-- =============================================================================

begin;

insert into sgc.parametros (clave, valor, descripcion) values
  ('incentivo_informe_roles',
   'admin,direccion,gerencia,logistica,jefe_flota',
   'AV7 — roles (roles.codigo) que reciben/ven el informe semanal de incentivos. Solo elevados + admin.')
on conflict (clave) do nothing;

-- Destinatarios del informe: usuarios ACTIVOS con al menos uno de los roles de la lista.
-- No usa el "OR módulo admin" que causaba la fuga. Devuelve email + nombre (como el
-- RPC anterior, para no cambiar el consumo del edge más allá del nombre de la función).
create or replace function sgc.destinatarios_informe_incentivo()
returns table (email text, nombre text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and r.codigo = any (sgc.param_csv('incentivo_informe_roles',
      'admin,direccion,gerencia,logistica,jefe_flota'));
$$;
grant execute on function sgc.destinatarios_informe_incentivo() to authenticated, service_role;

commit;
