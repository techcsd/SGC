-- 2026-10-08-cj10-resolver-nombres.sql
-- CJ10 — "Registrado por —" en Salidas: creado_por SÍ está y el usuario existe, pero el
-- embed a sgc.usuarios vuelve vacío por RLS (p. ej. un logístico no "ve" al conductor que
-- registró la salida). Resolver el nombre por RPC DEFINER (patrón CE2). Los nombres no son
-- sensibles; cualquier autenticado puede resolver un id → nombre. Aditivo.
--   node scripts/apply-migration.mjs sql/2026-10-08-cj10-resolver-nombres.sql --env dev
create or replace function sgc.resolver_nombres_usuarios(p_ids uuid[])
returns table(id uuid, nombre text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select u.id, u.nombre::text
  from sgc.usuarios u
  where u.id = any(coalesce(p_ids, '{}'::uuid[]));
$function$;
grant execute on function sgc.resolver_nombres_usuarios(uuid[]) to authenticated;
