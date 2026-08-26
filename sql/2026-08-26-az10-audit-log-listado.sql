-- AZ10 (follow-up) — Surface del log de acciones de administración (audit_log) en la
-- pantalla Administración → Auditoría: impersonaciones, cambios de rol, usuarios de prueba.
-- Es un log DISTINTO al change-log sgc.auditoria (triggers de tablas); por eso se expone
-- como pestaña propia. Solo admin.

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
           l.actor_id, a.nombre as actor_nombre,
           l.target_user_id, t.nombre as target_nombre,
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
