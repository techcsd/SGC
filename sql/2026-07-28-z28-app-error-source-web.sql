-- ============================================================================
-- Z28 — Reportes de errores también para la WEB (source app|web)
-- PROMPT-6 · FASE 8 · aditivo
-- ============================================================================
alter table sgc.app_error_reports add column if not exists source text not null default 'app'
  check (source in ('app', 'web'));
create index if not exists idx_app_error_reports_source on sgc.app_error_reports (source);

-- report_app_error: acepta p_source (default 'app' → retrocompatible con la app).
create or replace function sgc.report_app_error(
  p_error_type   text,
  p_message      text,
  p_stack        text default null,
  p_context      jsonb default '{}'::jsonb,
  p_device_model text default null,
  p_device_brand text default null,
  p_os_version   text default null,
  p_app_version  text default null,
  p_platform     text default null,
  p_source       text default 'app'
)
returns uuid
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_type  text;
  v_src   text;
  v_count int;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;

  v_type := lower(coalesce(p_error_type, 'other'));
  if v_type not in ('crash','error','camera','sync','permission','other') then v_type := 'other'; end if;
  v_src := lower(coalesce(p_source, 'app'));
  if v_src not in ('app','web') then v_src := 'app'; end if;

  select count(*) into v_count from sgc.app_error_reports
   where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_count >= 40 then return null; end if;

  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'message requerido' using errcode = '22023';
  end if;

  insert into sgc.app_error_reports (
    user_id, device_model, device_brand, os_version, app_version, platform,
    error_type, message, stack, context, source
  ) values (
    v_uid, left(p_device_model,120), left(p_device_brand,120), left(p_os_version,60),
    left(p_app_version,40), left(p_platform,20), v_type, left(p_message,2000), left(p_stack,8000),
    case when length(p_context::text) > 8000
         then jsonb_build_object('_truncated', true, 'preview', left(p_context::text, 2000))
         else coalesce(p_context, '{}'::jsonb) end,
    v_src
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.report_app_error(text,text,text,jsonb,text,text,text,text,text,text) to authenticated, service_role;

-- Agrupación: exponer source para filtrar el panel por origen.
create or replace function sgc.app_error_reports_grupos(
  p_desde timestamptz default null, p_hasta timestamptz default null,
  p_error_type text default null, p_limit int default 100, p_source text default null)
returns table (
  firma text, error_type text, source text, ocurrencias bigint, dispositivos bigint,
  primera_vez timestamptz, ultima_vez timestamptz, ejemplo_message text)
language sql stable security definer set search_path = sgc, public
as $$
  select left(r.message, 200) as firma,
    (array_agg(r.error_type order by r.created_at desc))[1] as error_type,
    (array_agg(r.source order by r.created_at desc))[1] as source,
    count(*) as ocurrencias,
    count(distinct coalesce(r.device_model,'?')) as dispositivos,
    min(r.created_at) as primera_vez, max(r.created_at) as ultima_vez,
    (array_agg(r.message order by r.created_at desc))[1] as ejemplo_message
  from sgc.app_error_reports r
  where sgc.es_tecnologia()
    and (p_desde is null or r.created_at >= p_desde)
    and (p_hasta is null or r.created_at <= p_hasta)
    and (p_error_type is null or r.error_type = p_error_type)
    and (p_source is null or r.source = p_source)
  group by left(r.message, 200)
  order by count(*) desc, max(r.created_at) desc
  limit greatest(1, least(coalesce(p_limit,100), 500));
$$;
grant execute on function sgc.app_error_reports_grupos(timestamptz,timestamptz,text,int,text) to authenticated, service_role;
