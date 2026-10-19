-- ============================================================================
-- CS4 — "Sesión y dispositivos" nunca tuvo lista (solo el botón de cerrar en
-- otros dispositivos). Regla 19: columnas de auth.sessions verificadas en vivo
-- en dev antes de escribir esto (id, user_id, created_at, updated_at,
-- refreshed_at, user_agent, ip, oauth_client_id — sin service role, SECURITY
-- DEFINER leyendo auth.sessions como ya hace sgc.* con auth.users).
--
-- Sin ciudad (no hay servicio de geolocalización): IP con el último octeto
-- oculto. `es_actual` compara contra el claim `session_id` del JWT (confirmado
-- en vivo contra una sesión real de dev). `cliente` = 'Claude Desktop' cuando
-- la sesión trae oauth_client_id (la del conector).
-- ============================================================================

begin;

create or replace function sgc.ip_parcial(p_ip inet)
 returns text
 language sql
 stable
 set search_path to 'sgc', 'pg_temp'
as $function$
  select case
    when p_ip is null then null
    when family(p_ip) = 4 then regexp_replace(host(p_ip), '\.\d+$', '.xxx')
    else regexp_replace(host(p_ip), ':[0-9a-fA-F]{1,4}$', ':xxxx')
  end;
$function$;
grant execute on function sgc.ip_parcial(inet) to authenticated;

create or replace function sgc.mis_sesiones()
 returns table (
   id uuid,
   created_at timestamptz,
   ultima_actividad timestamptz,
   user_agent text,
   ip_parcial text,
   es_actual boolean,
   cliente text
 )
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_actual uuid;
begin
  perform sgc.rechazar_si_cliente_oauth();
  v_actual := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  return query
  select
    s.id,
    s.created_at,
    coalesce(s.refreshed_at::timestamptz, s.updated_at),
    s.user_agent,
    sgc.ip_parcial(s.ip),
    s.id = v_actual,
    case when s.oauth_client_id is not null then 'Claude Desktop' else null end
  from auth.sessions s
  where s.user_id = auth.uid()
  order by coalesce(s.refreshed_at::timestamptz, s.updated_at) desc nulls last;
end;
$function$;
grant execute on function sgc.mis_sesiones() to authenticated;

create or replace function sgc.cerrar_mi_sesion(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_actual uuid;
  v_borradas int;
begin
  perform sgc.rechazar_si_cliente_oauth();
  if p_id is null then raise exception 'Indica la sesión a cerrar.' using errcode = '22023'; end if;
  v_actual := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if p_id = v_actual then
    raise exception 'No puedes cerrar la sesión actual desde aquí. Usa «Cerrar sesión».' using errcode = '22023';
  end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  get diagnostics v_borradas = row_count;
  if v_borradas = 0 then
    raise exception 'Esa sesión no existe o no es tuya.' using errcode = 'P0002';
  end if;
end;
$function$;
grant execute on function sgc.cerrar_mi_sesion(uuid) to authenticated;

commit;
