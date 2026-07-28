-- ============================================================================
-- Y6 — Telemetría de crashes/errores de la app (backend)
-- Ronda 28/07/2026 · PROMPT-1 · FASE 5
-- ============================================================================
-- Solución propia (sin Sentry): tabla + RPC de ingreso (authenticated, con
-- validación de tamaños y rate-limit anti-spam) + RLS de lectura solo para
-- admin/tecnologia. La app (csd-app, PROMPT-2) encola los reportes vía outbox y
-- los envía con `report_app_error`. El panel vive en el módulo Tecnología.
--
-- ADITIVO e idempotente.
-- ============================================================================

-- 1) Tabla ---------------------------------------------------------------------
create table if not exists sgc.app_error_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references sgc.usuarios(id) on delete set null,
  device_model text,
  device_brand text,
  os_version   text,
  app_version  text,
  platform     text,                         -- 'android' | 'ios' | 'web' (opcional)
  error_type   text not null default 'other'
               check (error_type in ('crash','error','camera','sync','permission','other')),
  message      text not null,
  stack        text,
  context      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table sgc.app_error_reports is
  'Y6 — reportes de errores/crashes enviados por la app (telemetría propia). INSERT solo vía RPC report_app_error; SELECT solo admin/tecnologia (es_tecnologia()).';

-- Índices para el panel (filtros + agrupación) --------------------------------
create index if not exists idx_app_error_reports_created_at on sgc.app_error_reports (created_at desc);
create index if not exists idx_app_error_reports_error_type on sgc.app_error_reports (error_type);
create index if not exists idx_app_error_reports_device_model on sgc.app_error_reports (device_model);
create index if not exists idx_app_error_reports_app_version on sgc.app_error_reports (app_version);

-- 2) RLS -----------------------------------------------------------------------
alter table sgc.app_error_reports enable row level security;

-- Lectura: solo admin/tecnologia. (Sin política de INSERT: los inserts van por
-- el RPC SECURITY DEFINER, que corre como dueño y salta RLS. Log inmutable: sin
-- UPDATE ni DELETE para roles de aplicación.)
drop policy if exists "app_error_reports: read tecnologia" on sgc.app_error_reports;
create policy "app_error_reports: read tecnologia"
  on sgc.app_error_reports
  for select
  to authenticated
  using (sgc.es_tecnologia());

-- Grants de tabla (recurrente: sin esto -> "permission denied for schema/table")
grant select on sgc.app_error_reports to authenticated;
grant select, insert on sgc.app_error_reports to service_role;

-- 3) RPC de ingreso ------------------------------------------------------------
-- Ejecutable por authenticated. Valida tipo, acota tamaños, rate-limit básico
-- (máx 40 reportes/usuario/hora) y devuelve el id insertado (o null si se
-- descartó por rate-limit — el cliente NO debe reintentar ni reportar el fallo,
-- anti-loop). SECURITY DEFINER para insertar saltando la RLS de la tabla.
create or replace function sgc.report_app_error(
  p_error_type   text,
  p_message      text,
  p_stack        text default null,
  p_context      jsonb default '{}'::jsonb,
  p_device_model text default null,
  p_device_brand text default null,
  p_os_version   text default null,
  p_app_version  text default null,
  p_platform     text default null
)
returns uuid
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_type  text;
  v_count int;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  -- Normaliza tipo a la lista permitida.
  v_type := lower(coalesce(p_error_type, 'other'));
  if v_type not in ('crash','error','camera','sync','permission','other') then
    v_type := 'other';
  end if;

  -- Rate-limit anti-spam: 40 reportes por usuario en la última hora.
  select count(*) into v_count
  from sgc.app_error_reports
  where user_id = v_uid
    and created_at > now() - interval '1 hour';
  if v_count >= 40 then
    return null;   -- descartado silenciosamente (anti-loop en el cliente)
  end if;

  -- Mensaje obligatorio y acotado; stack y context acotados.
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'message requerido' using errcode = '22023';
  end if;

  insert into sgc.app_error_reports (
    user_id, device_model, device_brand, os_version, app_version, platform,
    error_type, message, stack, context
  ) values (
    v_uid,
    left(p_device_model, 120),
    left(p_device_brand, 120),
    left(p_os_version, 60),
    left(p_app_version, 40),
    left(p_platform, 20),
    v_type,
    left(p_message, 2000),
    left(p_stack, 8000),
    -- Acota el tamaño del context a ~8KB serializado para evitar payloads enormes.
    case when length(p_context::text) > 8000
         then jsonb_build_object('_truncated', true, 'preview', left(p_context::text, 2000))
         else coalesce(p_context, '{}'::jsonb) end
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function sgc.report_app_error(text,text,text,jsonb,text,text,text,text,text) to authenticated, service_role;

comment on function sgc.report_app_error is
  'Y6 — ingreso de un reporte de error de la app. authenticated. Valida tipo/tamaños, rate-limit 40/usuario/hora, devuelve id (o null si descartado).';

-- 4) RPC de agrupación para el panel ------------------------------------------
-- Agrupa por firma de mensaje (primeros 200 chars) con contador de ocurrencias,
-- primer/último visto y nº de dispositivos afectados. Gateado a admin/tecnologia.
create or replace function sgc.app_error_reports_grupos(
  p_desde       timestamptz default null,
  p_hasta       timestamptz default null,
  p_error_type  text default null,
  p_limit       int default 100
)
returns table (
  firma          text,
  error_type     text,
  ocurrencias    bigint,
  dispositivos   bigint,
  primera_vez    timestamptz,
  ultima_vez     timestamptz,
  ejemplo_message text
)
language sql
stable
security definer
set search_path = sgc, public
as $$
  select
    left(r.message, 200)                         as firma,
    (array_agg(r.error_type order by r.created_at desc))[1] as error_type,
    count(*)                                      as ocurrencias,
    count(distinct coalesce(r.device_model,'?'))  as dispositivos,
    min(r.created_at)                             as primera_vez,
    max(r.created_at)                             as ultima_vez,
    (array_agg(r.message order by r.created_at desc))[1] as ejemplo_message
  from sgc.app_error_reports r
  where sgc.es_tecnologia()
    and (p_desde is null or r.created_at >= p_desde)
    and (p_hasta is null or r.created_at <= p_hasta)
    and (p_error_type is null or r.error_type = p_error_type)
  group by left(r.message, 200)
  order by count(*) desc, max(r.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

grant execute on function sgc.app_error_reports_grupos(timestamptz,timestamptz,text,int) to authenticated, service_role;

comment on function sgc.app_error_reports_grupos is
  'Y6 — agrupación de reportes de error por firma de mensaje para el panel Tecnología. Solo admin/tecnologia.';
