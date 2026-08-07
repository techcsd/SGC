-- =============================================================================
-- PROMPT-10 FASE 2 (AH5) — lista de choferes activos para el picker de transferencia.
-- `choferes_estado()` restringe filas a flota-elevado o a uno mismo, así que un
-- chofer normal no ve a los demás y no podría elegir a quién transferir un conduce.
-- Este RPC (SECURITY DEFINER, solo nombres) devuelve los conductores activos a
-- cualquier autenticado para poblar ese selector. Aditivo.
-- =============================================================================

begin;

create or replace function sgc.choferes_activos()
returns table (conductor_id uuid, nombre text)
language sql stable security definer set search_path to 'sgc','pg_temp'
as $function$
  select c.id as conductor_id, coalesce(u.nombre, c.nombre) as nombre
  from sgc.conductores c
  left join sgc.usuarios u on u.id = c.usuario_id
  where coalesce(c.activo, true)
  order by nombre;
$function$;
grant execute on function sgc.choferes_activos() to authenticated;

commit;
