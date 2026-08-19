-- ============================================================================
-- PROMPT-25 (AW) — Ronda 21/08/2026.
-- AW14: Reportes de errores — workflow de atención + Historial + metadata.
--   • Estado por FIRMA de error (raíz), no por fila (los errores recurren):
--       abierto → en_revision → solucionado.  Al resolverse pasa al Historial.
--   • Auto-reapertura: si llega una ocurrencia nueva de una firma ya "solucionado",
--     se reabre automáticamente (reabierto_at) para que vuelva a la bandeja.
--   • Metadata completa por ocurrencia (usuario, dispositivo, SO, versión,
--     plataforma, timestamp) vía RPC de detalle por firma.
--   • Quién puede resolver: es_tecnologia() (admin/tecnología/gerencia/dirección).
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/apply-sql.mjs sql/2026-08-21-aw14-reportes-errores-workflow.sql
-- ============================================================================
set search_path = sgc, public;

-- ── 1) Firma canónica de un error (misma expresión que usa la agrupación) ───
create or replace function sgc.error_firma(p_message text)
returns text
language sql immutable
set search_path = sgc, public
as $$
  select left(coalesce(p_message, ''), 200);
$$;
grant execute on function sgc.error_firma(text) to authenticated, service_role;

-- ── 2) Estado del workflow por firma ────────────────────────────────────────
create table if not exists sgc.app_error_estados (
  firma        text primary key,
  estado       text not null default 'abierto'
                 check (estado in ('abierto','en_revision','solucionado')),
  nota         text,
  resuelto_por uuid references sgc.usuarios(id) on delete set null,
  resuelto_at  timestamptz,
  reabierto_at timestamptz,
  updated_at   timestamptz not null default now()
);
comment on table sgc.app_error_estados is
  'AW14 — estado de atención por firma de error (abierto/en_revision/solucionado). Los reportes crudos siguen en app_error_reports; esto es la capa de triage/Historial.';

alter table sgc.app_error_estados enable row level security;
drop policy if exists aee_select on sgc.app_error_estados;
create policy aee_select on sgc.app_error_estados for select to authenticated
  using (sgc.es_tecnologia());
-- Escritura solo por RPC SECURITY DEFINER (sin policy de escritura directa).
grant select on sgc.app_error_estados to authenticated;
grant all on sgc.app_error_estados to service_role;

-- ── 3) Agrupación con estado + usuarios + filtro por estado ─────────────────
drop function if exists sgc.app_error_reports_grupos(timestamptz,timestamptz,text,int,text);
create or replace function sgc.app_error_reports_grupos(
  p_desde timestamptz default null, p_hasta timestamptz default null,
  p_error_type text default null, p_limit int default 100, p_source text default null,
  p_estado text default null)
returns table (
  firma text, error_type text, source text, ocurrencias bigint,
  dispositivos bigint, usuarios bigint,
  primera_vez timestamptz, ultima_vez timestamptz, ejemplo_message text,
  estado text, nota text, resuelto_por_nombre text, resuelto_at timestamptz,
  reabierto_at timestamptz)
language sql stable security definer set search_path = sgc, public
as $$
  with g as (
    select left(r.message, 200) as firma,
      (array_agg(r.error_type order by r.created_at desc))[1] as error_type,
      (array_agg(r.source order by r.created_at desc))[1] as source,
      count(*) as ocurrencias,
      count(distinct coalesce(r.device_model,'?')) as dispositivos,
      count(distinct r.user_id) as usuarios,
      min(r.created_at) as primera_vez, max(r.created_at) as ultima_vez,
      (array_agg(r.message order by r.created_at desc))[1] as ejemplo_message
    from sgc.app_error_reports r
    where sgc.es_tecnologia()
      and (p_desde is null or r.created_at >= p_desde)
      and (p_hasta is null or r.created_at <= p_hasta)
      and (p_error_type is null or r.error_type = p_error_type)
      and (p_source is null or r.source = p_source)
    group by left(r.message, 200)
  )
  select g.firma, g.error_type, g.source, g.ocurrencias, g.dispositivos, g.usuarios,
    g.primera_vez, g.ultima_vez, g.ejemplo_message,
    coalesce(e.estado, 'abierto') as estado, e.nota,
    u.nombre as resuelto_por_nombre, e.resuelto_at, e.reabierto_at
  from g
  left join sgc.app_error_estados e on e.firma = g.firma
  left join sgc.usuarios u on u.id = e.resuelto_por
  where (p_estado is null
         or (p_estado = 'solucionado' and coalesce(e.estado,'abierto') = 'solucionado')
         or (p_estado = 'abiertos'    and coalesce(e.estado,'abierto') <> 'solucionado')
         or (p_estado = coalesce(e.estado,'abierto')))
  order by g.ocurrencias desc, g.ultima_vez desc
  limit greatest(1, least(coalesce(p_limit,100), 500));
$$;
grant execute on function sgc.app_error_reports_grupos(timestamptz,timestamptz,text,int,text,text) to authenticated, service_role;

-- ── 4) Ocurrencias de una firma (detalle + metadata + usuario) ──────────────
create or replace function sgc.app_error_reports_por_firma(
  p_firma text, p_limit int default 100)
returns table (
  id uuid, created_at timestamptz, error_type text, source text,
  message text, stack text, context jsonb,
  user_id uuid, usuario_nombre text, usuario_email text,
  device_model text, device_brand text, os_version text,
  app_version text, platform text)
language sql stable security definer set search_path = sgc, public
as $$
  select r.id, r.created_at, r.error_type, r.source,
    r.message, r.stack, r.context,
    r.user_id, u.nombre, u.email,
    r.device_model, r.device_brand, r.os_version, r.app_version, r.platform
  from sgc.app_error_reports r
  left join sgc.usuarios u on u.id = r.user_id
  where sgc.es_tecnologia()
    and left(r.message, 200) = p_firma
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit,100), 500));
$$;
grant execute on function sgc.app_error_reports_por_firma(text,int) to authenticated, service_role;

-- ── 5) Marcar estado (triage). Solo tecnología/admin. ───────────────────────
create or replace function sgc.marcar_error_estado(
  p_firma text, p_estado text, p_nota text default null)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not sgc.es_tecnologia() then
    raise exception 'Sin permiso para atender reportes de errores' using errcode = '42501';
  end if;
  if coalesce(trim(p_firma),'') = '' then
    raise exception 'firma requerida' using errcode = '22023';
  end if;
  if p_estado not in ('abierto','en_revision','solucionado') then
    raise exception 'estado inválido' using errcode = '22023';
  end if;

  insert into sgc.app_error_estados (firma, estado, nota, resuelto_por, resuelto_at, updated_at)
  values (
    p_firma, p_estado, nullif(trim(p_nota),''),
    case when p_estado = 'solucionado' then v_uid else null end,
    case when p_estado = 'solucionado' then now() else null end,
    now())
  on conflict (firma) do update set
    estado = excluded.estado,
    nota = coalesce(excluded.nota, sgc.app_error_estados.nota),
    resuelto_por = case when p_estado = 'solucionado' then v_uid else null end,
    resuelto_at  = case when p_estado = 'solucionado' then now() else null end,
    reabierto_at = case when p_estado = 'solucionado' then sgc.app_error_estados.reabierto_at else null end,
    updated_at = now();
end;
$$;
grant execute on function sgc.marcar_error_estado(text,text,text) to authenticated, service_role;

-- ── 6) Auto-reapertura: un reporte nuevo de una firma "solucionado" la reabre ─
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
  v_firma text;
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

  -- AW14 — si esta firma estaba "solucionado", reabrir (reapareció el error).
  v_firma := left(left(p_message,2000), 200);
  update sgc.app_error_estados
     set estado = 'abierto', reabierto_at = now(), updated_at = now()
   where firma = v_firma and estado = 'solucionado';

  return v_id;
end;
$$;
grant execute on function sgc.report_app_error(text,text,text,jsonb,text,text,text,text,text,text) to authenticated, service_role;
