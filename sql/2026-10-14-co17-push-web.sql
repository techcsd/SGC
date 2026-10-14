-- ============================================================================
-- CO10 + CO17 — PROMPT-98 FASE 6 (14/10/2026) — Web Push para la PWA (servidor)
-- "the pwa (iphone) has an active warning... if i try to click it it didnt
-- work" (#220) + hallazgo CO17: la PWA no tiene Web Push, así que "activar" no
-- podía servir de nada — ningún aviso llega con la app cerrada.
--
-- Esta migración es SOLO el servidor: tabla de suscripciones + RPCs + el envío
-- desde `send-push`. El botón "Activar" / la hoja de permiso denegado / etc.
-- (cliente) es PROMPT-99 F4.
-- ============================================================================
begin;
set local search_path = sgc, public;

create table if not exists sgc.push_suscripciones_web (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  plataforma  text,                                 -- 'ios-pwa' | 'android-pwa' | 'web' (informativo)
  user_agent  text,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  ultimo_ok_at timestamptz,
  unique (endpoint)
);
comment on table sgc.push_suscripciones_web is
  'CO17 — suscripciones Web Push (VAPID) de PWAs instaladas (iPhone principalmente). send-push las usa además de FCM.';

create index if not exists idx_push_suscripciones_web_usuario on sgc.push_suscripciones_web (usuario_id, activa);

alter table sgc.push_suscripciones_web enable row level security;
drop policy if exists push_susc_web_select on sgc.push_suscripciones_web;
create policy push_susc_web_select on sgc.push_suscripciones_web
  for select to authenticated using (usuario_id = auth.uid() or sgc.es_tecnologia());
grant select on sgc.push_suscripciones_web to authenticated;
-- send-push (edge, service_role) necesita leer TODAS las suscripciones activas de
-- los destinatarios y marcar `ultimo_ok_at`/`activa` — service_role no bypasea
-- grants de tabla (solo RLS), así que necesita su propio GRANT explícito.
grant select, update on sgc.push_suscripciones_web to service_role;

create or replace function sgc.registrar_suscripcion_web(
  p_endpoint text, p_p256dh text, p_auth text, p_plataforma text default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_endpoint,'')),'') is null then
    raise exception 'Falta el endpoint de la suscripción.' using errcode = '22023';
  end if;
  insert into sgc.push_suscripciones_web (usuario_id, endpoint, p256dh, auth, plataforma, user_agent, activa)
    values (v_uid, p_endpoint, p_p256dh, p_auth, nullif(p_plataforma,''), nullif(p_user_agent,''), true)
  on conflict (endpoint) do update
    set usuario_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth,
        plataforma = coalesce(excluded.plataforma, sgc.push_suscripciones_web.plataforma),
        user_agent = coalesce(excluded.user_agent, sgc.push_suscripciones_web.user_agent),
        activa = true
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function sgc.registrar_suscripcion_web(text,text,text,text,text) to authenticated;

create or replace function sgc.baja_suscripcion_web(p_endpoint text)
returns void
language plpgsql security definer set search_path = sgc, public
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado.' using errcode = '42501'; end if;
  update sgc.push_suscripciones_web
     set activa = false
   where endpoint = p_endpoint and usuario_id = auth.uid();
end;
$$;
grant execute on function sgc.baja_suscripcion_web(text) to authenticated;

-- CO10 — Sistema › dispositivos: cuántos iPhone (ios-pwa) tienen Web Push activo.
create or replace function sgc.push_web_resumen()
returns table(plataforma text, activas bigint, usuarios bigint)
language plpgsql stable security definer set search_path = sgc, public
as $$
begin
  if not sgc.es_tecnologia() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  return query
    select coalesce(s.plataforma, 'desconocida'), count(*)::bigint, count(distinct s.usuario_id)::bigint
    from sgc.push_suscripciones_web s
    where s.activa
    group by coalesce(s.plataforma, 'desconocida');
end;
$$;
grant execute on function sgc.push_web_resumen() to authenticated;

commit;
