-- ════════════════════════════════════════════════════════════════════════════
-- PROMPT-32 (BI4) — El panel de "Reportes de errores" mide bien.
-- Ronda 03/09/2026. Aditivo, idempotente, retrocompatible.
--
-- (1) Whitelist de tipo ampliada: la app manda tracking/login/gps/voice y el server
--     los coaccionaba a 'other' (por eso "Otro" dominaba). Se añaden al CHECK.
-- (2) error_firma NORMALIZA (uuids, números, nombres entre comillas) antes de
--     recortar → una causa raíz es UN grupo, no varias caras. La tabla de estados
--     está vacía (0 triaje), así que no hay que remapear nada.
-- (3) "Solucionado" recuerda la VERSIÓN en que se cerró; la auto-reapertura sólo
--     dispara si la ocurrencia viene de una versión >= esa (un cliente viejo que
--     nunca recibió el fix no reabre el grupo; se cuenta aparte).
-- (4) La agrupación usa error_firma (antes usaba left(message,200) crudo) y expone
--     ejemplo_id (para "crear issue por grupo") + la versión de cierre.
-- ════════════════════════════════════════════════════════════════════════════
begin;
set local search_path = sgc, public;

-- ── (2) Firma normalizada ────────────────────────────────────────────────────
create or replace function sgc.error_firma(p_message text)
returns text
language sql immutable
set search_path = sgc, public
as $$
  -- Normaliza el RUIDO (uuids, números, valores entre paréntesis) pero PRESERVA los
  -- identificadores entre comillas: el nombre de un constraint/relación ES la causa
  -- (dos constraints distintos son dos grupos distintos), no debe fundirse.
  select left(
    regexp_replace(                                   -- 4) colapsa espacios
      regexp_replace(                                 -- 3) valores entre paréntesis → (…)
        regexp_replace(                               -- 2) números sueltos → <n>
          regexp_replace(                             -- 1) uuids → <id>
            coalesce(p_message, ''),
            '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi'),
          '\m\d+\M', '<n>', 'g'),
        '\([^)]*\)', '(…)', 'g'),
      '\s+', ' ', 'g'),
    200);
$$;
grant execute on function sgc.error_firma(text) to authenticated, service_role;

-- ── (3) La capa de estados recuerda la versión de cierre ─────────────────────
alter table sgc.app_error_estados
  add column if not exists resuelto_en_version text,
  add column if not exists ocurrencias_cliente_viejo int not null default 0;
comment on column sgc.app_error_estados.resuelto_en_version is
  'BI4 — versión (app/web) en la que se marcó solucionado. La reapertura sólo dispara para ocurrencias de versión >= esta.';

-- ── (4) marcar_error_estado acepta la versión de cierre ──────────────────────
drop function if exists sgc.marcar_error_estado(text,text,text);
create or replace function sgc.marcar_error_estado(
  p_firma text, p_estado text, p_nota text default null, p_resuelto_en_version text default null)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
declare v_uid uuid := auth.uid();
begin
  if not sgc.es_tecnologia() then
    raise exception 'Sin permiso para atender reportes de errores' using errcode = '42501';
  end if;
  if coalesce(trim(p_firma),'') = '' then raise exception 'firma requerida' using errcode = '22023'; end if;
  if p_estado not in ('abierto','en_revision','solucionado') then raise exception 'estado inválido' using errcode = '22023'; end if;

  insert into sgc.app_error_estados (firma, estado, nota, resuelto_por, resuelto_at, resuelto_en_version, updated_at)
  values (
    p_firma, p_estado, nullif(trim(p_nota),''),
    case when p_estado = 'solucionado' then v_uid else null end,
    case when p_estado = 'solucionado' then now() else null end,
    case when p_estado = 'solucionado' then nullif(trim(p_resuelto_en_version),'') else null end,
    now())
  on conflict (firma) do update set
    estado = excluded.estado,
    nota = coalesce(excluded.nota, sgc.app_error_estados.nota),
    resuelto_por = case when p_estado = 'solucionado' then v_uid else null end,
    resuelto_at  = case when p_estado = 'solucionado' then now() else null end,
    resuelto_en_version = case when p_estado = 'solucionado'
                               then coalesce(nullif(trim(p_resuelto_en_version),''), sgc.app_error_estados.resuelto_en_version)
                               else null end,
    reabierto_at = case when p_estado = 'solucionado' then sgc.app_error_estados.reabierto_at else null end,
    ocurrencias_cliente_viejo = case when p_estado = 'solucionado' then sgc.app_error_estados.ocurrencias_cliente_viejo else 0 end,
    updated_at = now();
end;
$$;
grant execute on function sgc.marcar_error_estado(text,text,text,text) to authenticated, service_role;

-- ── (1)+(3) report_app_error: whitelist ampliada + firma normalizada + reapertura por versión ─
create or replace function sgc.report_app_error(
  p_error_type text, p_message text, p_stack text default null, p_context jsonb default '{}'::jsonb,
  p_device_model text default null, p_device_brand text default null, p_os_version text default null,
  p_app_version text default null, p_platform text default null, p_source text default 'app')
returns uuid
language plpgsql security definer set search_path to 'sgc','public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_type text; v_src text; v_count int; v_id uuid; v_firma text;
  v_est sgc.app_error_estados%rowtype;
  v_reabre boolean;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;

  -- (1) tipos que el sistema realmente produce (antes se coaccionaban a 'other').
  v_type := lower(coalesce(p_error_type, 'other'));
  if v_type not in ('crash','error','camera','sync','permission','other','tracking','login','gps','voice') then v_type := 'other'; end if;
  v_src := lower(coalesce(p_source, 'app'));
  if v_src not in ('app','web') then v_src := 'app'; end if;

  select count(*) into v_count from sgc.app_error_reports
   where user_id = v_uid and created_at > now() - interval '1 hour';
  if v_count >= 40 then return null; end if;

  if p_message is null or length(trim(p_message)) = 0 then raise exception 'message requerido' using errcode = '22023'; end if;

  -- BH — ruido conocido del watchdog (se descarta en el ingest).
  if lower(coalesce(p_message, '')) like 'watchdog:%re-armando watcher%' then return null; end if;

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

  -- (3) reapertura POR VERSIÓN: sólo si la firma estaba solucionado y la ocurrencia
  -- viene de una versión >= la de cierre. Un cliente viejo NO reabre; se cuenta aparte.
  v_firma := sgc.error_firma(left(p_message,2000));
  select * into v_est from sgc.app_error_estados where firma = v_firma;
  if found and v_est.estado = 'solucionado' then
    v_reabre := v_est.resuelto_en_version is null
             or nullif(trim(coalesce(p_app_version,'')),'') is null
             or sgc.semver_code(p_app_version) >= sgc.semver_code(v_est.resuelto_en_version);
    if v_reabre then
      update sgc.app_error_estados set estado = 'abierto', reabierto_at = now(), updated_at = now()
       where firma = v_firma;
    else
      update sgc.app_error_estados set ocurrencias_cliente_viejo = ocurrencias_cliente_viejo + 1, updated_at = now()
       where firma = v_firma;
    end if;
  end if;

  return v_id;
end;
$function$;
grant execute on function sgc.report_app_error(text,text,text,jsonb,text,text,text,text,text,text) to authenticated, service_role;

-- ── (4) Agrupación: firma normalizada + ejemplo_id + versión de cierre + cap alto ─
drop function if exists sgc.app_error_reports_grupos(timestamptz,timestamptz,text,int,text,text);
create or replace function sgc.app_error_reports_grupos(
  p_desde timestamptz default null, p_hasta timestamptz default null,
  p_error_type text default null, p_limit int default 100, p_source text default null,
  p_estado text default null)
returns table (
  firma text, error_type text, source text, ocurrencias bigint,
  dispositivos bigint, usuarios bigint,
  primera_vez timestamptz, ultima_vez timestamptz, ejemplo_message text, ejemplo_id uuid,
  estado text, nota text, resuelto_por_nombre text, resuelto_at timestamptz,
  reabierto_at timestamptz, resuelto_en_version text, ocurrencias_cliente_viejo int)
language sql stable security definer set search_path = sgc, public
as $$
  with g as (
    select sgc.error_firma(r.message) as firma,
      (array_agg(r.error_type order by r.created_at desc))[1] as error_type,
      (array_agg(r.source order by r.created_at desc))[1] as source,
      count(*) as ocurrencias,
      count(distinct coalesce(r.device_model,'?')) as dispositivos,
      count(distinct r.user_id) as usuarios,
      min(r.created_at) as primera_vez, max(r.created_at) as ultima_vez,
      (array_agg(r.message order by r.created_at desc))[1] as ejemplo_message,
      (array_agg(r.id order by r.created_at desc))[1] as ejemplo_id
    from sgc.app_error_reports r
    where sgc.es_tecnologia()
      and (p_desde is null or r.created_at >= p_desde)
      and (p_hasta is null or r.created_at <= p_hasta)
      and (p_error_type is null or r.error_type = p_error_type)
      and (p_source is null or r.source = p_source)
    group by sgc.error_firma(r.message)
  )
  select g.firma, g.error_type, g.source, g.ocurrencias, g.dispositivos, g.usuarios,
    g.primera_vez, g.ultima_vez, g.ejemplo_message, g.ejemplo_id,
    coalesce(e.estado, 'abierto') as estado, e.nota,
    u.nombre as resuelto_por_nombre, e.resuelto_at, e.reabierto_at,
    e.resuelto_en_version, coalesce(e.ocurrencias_cliente_viejo, 0)
  from g
  left join sgc.app_error_estados e on e.firma = g.firma
  left join sgc.usuarios u on u.id = e.resuelto_por
  where (p_estado is null
         or (p_estado = 'solucionado' and coalesce(e.estado,'abierto') = 'solucionado')
         or (p_estado = 'abiertos'    and coalesce(e.estado,'abierto') <> 'solucionado')
         or (p_estado = coalesce(e.estado,'abierto')))
  order by g.ocurrencias desc, g.ultima_vez desc
  limit greatest(1, least(coalesce(p_limit,100), 5000));
$$;
grant execute on function sgc.app_error_reports_grupos(timestamptz,timestamptz,text,int,text,text) to authenticated, service_role;

-- ── por_firma: coincide por firma normalizada ────────────────────────────────
create or replace function sgc.app_error_reports_por_firma(p_firma text, p_limit int default 100)
returns table (
  id uuid, created_at timestamptz, error_type text, source text,
  message text, stack text, context jsonb,
  user_id uuid, usuario_nombre text, usuario_email text,
  device_model text, device_brand text, os_version text, app_version text, platform text)
language sql stable security definer set search_path = sgc, public
as $$
  select r.id, r.created_at, r.error_type, r.source, r.message, r.stack, r.context,
    r.user_id, u.nombre, u.email, r.device_model, r.device_brand, r.os_version, r.app_version, r.platform
  from sgc.app_error_reports r
  left join sgc.usuarios u on u.id = r.user_id
  where sgc.es_tecnologia() and sgc.error_firma(r.message) = p_firma
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit,100), 2000));
$$;
grant execute on function sgc.app_error_reports_por_firma(text,int) to authenticated, service_role;

commit;
