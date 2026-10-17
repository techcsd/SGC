-- CQ3/CQ5 (16-oct-2026) — fix del error "structure of query does not match
-- function result type" en Acciones de admin (nota #242).
--
-- Causa: `sgc.audit_log_listado` (sql/2026-08-26-az10-audit-log-listado.sql)
-- declara `actor_nombre text`/`target_nombre text` pero el `return query select`
-- devuelve `a.nombre`/`t.nombre` (sgc.usuarios.nombre es `character varying`,
-- no `text`) sin cast. Las funciones LANGUAGE plpgsql con `return query` NO
-- reciben coerción automática varchar→text (a diferencia de LANGUAGE sql, donde
-- el planner sí la inserta) — por eso explota en runtime. Mismo defecto que se
-- arregló el 30-sep en `auditoria_actores` (sql/2026-09-30-cd2-auditoria-filtros.sql).
--
-- CQ5 — barrido: se revisaron las 32 funciones LANGUAGE plpgsql con
-- `returns table(...)` de los esquemas sgc/public (heurística: columna
-- declarada `text` alimentada por `alias.columna` de un tipo real
-- varchar/name/character, sin `::text`). `audit_log_listado` fue la ÚNICA con
-- el defecto real — las 15 funciones LANGUAGE sql que la heurística ingenua
-- marcaba primero (listar_ordenes_trabajo, requisiciones_bandeja,
-- conduces_web_listado, etc.) NO están rotas: el planner de SQL sí aplica el
-- cast implícito varchar→text automáticamente, por eso funcionan en prod sin
-- error pese a no tener `::text` explícito.
--
-- Definición tomada de PROD (regla 19, pg_get_functiondef en vivo) — idéntica
-- al archivo original salvo los dos `::text` agregados.

begin;

create or replace function sgc.audit_log_listado(
  p_limit int default 40,
  p_offset int default 0,
  p_action text default null
)
returns table(
  id uuid, action text,
  actor_id uuid, actor_nombre text,
  target_user_id uuid, target_nombre text,
  metadata jsonb, created_at timestamptz, total bigint
)
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede ver el registro de acciones de administración.';
  end if;
  return query
    select l.id, l.action,
           l.actor_id, a.nombre::text as actor_nombre,
           l.target_user_id, t.nombre::text as target_nombre,
           l.metadata, l.created_at,
           count(*) over() as total
      from sgc.audit_log l
      left join sgc.usuarios a on a.id = l.actor_id
      left join sgc.usuarios t on t.id = l.target_user_id
     where (p_action is null or l.action = p_action)
     order by l.created_at desc
     limit greatest(1, least(p_limit, 200))
    offset greatest(0, p_offset);
end;
$function$;

grant execute on function sgc.audit_log_listado(int, int, text) to authenticated;

commit;
