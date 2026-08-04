-- ============================================================================
-- AF7 / AF8 — Notificaciones push: infraestructura + recordatorio dominical
-- Ronda 03/08/2026 (IDs AF) — PROMPT-1 FASE 5
--
--   AF7: tabla de device tokens por usuario + helper send_push(user_ids, ...) que
--        dispara la edge function `send-push` (FCM Android; iOS PWA con fallback
--        in-app documentado). `notificar` (per-usuario) también empuja push, así
--        cualquier notificación existente (ruta asignada, tarea, conduce por
--        confirmar…) llega al dispositivo sin tocar cada call-site.
--   AF8: RPC recordatorio_reporte_semanal() + pg_cron los domingos 8am-8pm hora RD
--        a cada usuario con vehículo asignado SIN reporte semanal; respeta es_prueba.
--
-- La edge function no-op si faltan credenciales FCM (igual que Resend/Vault).
-- Aditivo, idempotente. Patrón cron/secret = Y17 (infra_sync_secret en Vault).
-- ============================================================================

-- ── Device tokens ───────────────────────────────────────────────────────────
create table if not exists sgc.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  token       text not null unique,
  plataforma  text not null default 'android' check (plataforma in ('android', 'ios', 'web')),
  activo      boolean not null default true,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_device_tokens_usuario on sgc.device_tokens (usuario_id) where activo;

alter table sgc.device_tokens enable row level security;

drop policy if exists "device_tokens: own" on sgc.device_tokens;
create policy "device_tokens: own" on sgc.device_tokens
  for all to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin())
  with check (usuario_id = auth.uid() or sgc.is_admin());

grant select, insert, update, delete on sgc.device_tokens to authenticated;
grant all on sgc.device_tokens to service_role;

-- Registrar/renovar el token del dispositivo del usuario actual.
create or replace function sgc.registrar_device_token(p_token text, p_plataforma text default 'android')
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if coalesce(p_plataforma,'') not in ('android','ios','web') then p_plataforma := 'android'; end if;
  insert into sgc.device_tokens (usuario_id, token, plataforma, activo, updated_at)
  values (v_uid, p_token, p_plataforma, true, now())
  on conflict (token) do update
    set usuario_id = v_uid, plataforma = excluded.plataforma, activo = true, updated_at = now();
end;
$$;
grant execute on function sgc.registrar_device_token(text, text) to authenticated, service_role;

create or replace function sgc.eliminar_device_token(p_token text)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  update sgc.device_tokens set activo = false, updated_at = now()
  where token = p_token and (usuario_id = auth.uid() or sgc.is_admin());
end;
$$;
grant execute on function sgc.eliminar_device_token(text) to authenticated, service_role;

-- ── Helper: enviar push a una lista de usuarios (best-effort) ────────────────
-- Dispara la edge function send-push (que resuelve los tokens y llama a FCM).
-- No falla nunca la transacción que la invoca.
create or replace function sgc.send_push(
  p_user_ids uuid[],
  p_titulo   text,
  p_cuerpo   text,
  p_data     jsonb default '{}'::jsonb
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp', 'extensions', 'public'
as $$
declare
  v_secret text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;
  -- Sólo intenta si hay al menos un token activo para esos usuarios.
  if not exists (
    select 1 from sgc.device_tokens dt where dt.activo and dt.usuario_id = any(p_user_ids)
  ) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';

  begin
    perform net.http_post(
      url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sync-secret', coalesce(v_secret, '')
      ),
      body := jsonb_build_object(
        'user_ids', to_jsonb(p_user_ids),
        'titulo', p_titulo,
        'cuerpo', p_cuerpo,
        'data', coalesce(p_data, '{}'::jsonb)
      )
    );
  exception when others then
    -- pg_net ausente o error de red: la push es best-effort, no rompe nada.
    null;
  end;
end;
$$;
grant execute on function sgc.send_push(uuid[], text, text, jsonb) to authenticated, service_role;

-- ── notificar() ahora también empuja push al usuario ────────────────────────
-- Cualquier notificación per-usuario existente (ruta asignada, tarea asignada,
-- conduce/entrada por confirmar) llega al dispositivo sin tocar los call-sites.
create or replace function sgc.notificar(
  p_usuario uuid, p_tipo text, p_titulo text, p_mensaje text, p_ruta text
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if p_usuario is null then return; end if;

  insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta)
  values (p_usuario, coalesce(p_tipo,'info'), p_titulo, p_mensaje, p_ruta);

  -- AF7 — espejo en push (best-effort).
  perform sgc.send_push(
    array[p_usuario], p_titulo, coalesce(p_mensaje, ''),
    jsonb_build_object('tipo', coalesce(p_tipo,'info'), 'ruta', p_ruta)
  );
end;
$$;
grant execute on function sgc.notificar(uuid, text, text, text, text) to authenticated, service_role;

-- ── AF8 — Recordatorio del reporte semanal (domingos) ───────────────────────
-- A cada usuario con vehículo asignado que NO envió su reporte de esta semana:
-- notificación in-app + push. Respeta es_prueba (omite vehículos de prueba).
create or replace function sgc.recordatorio_reporte_semanal()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_anio   int := extract(isoyear from (now() at time zone 'America/Santo_Domingo'))::int;
  v_semana int := extract(week   from (now() at time zone 'America/Santo_Domingo'))::int;
  r record;
  v_n int := 0;
begin
  for r in
    select distinct c.chofer_usuario_id as usuario_id, c.placa
    from sgc.v_reporte_semanal_cumplimiento c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    where c.anio = v_anio and c.semana = v_semana
      and not coalesce(c.tiene_reporte, false)
      and c.chofer_usuario_id is not null
      and not coalesce(v.es_prueba, false)
  loop
    perform sgc.notificar(
      r.usuario_id, 'warning',
      'Reporte semanal pendiente',
      format('Aún no has enviado el reporte semanal de %s. Envíalo desde la app.', coalesce(r.placa, 'tu vehículo')),
      '/flota/reporte-semanal'
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function sgc.recordatorio_reporte_semanal() to authenticated, service_role;

-- ── Cron dominical (hora RD = UTC-4) — 8, 11, 14, 17, 20h RD ────────────────
-- 8/11/14/17 RD = 12/15/18/21 UTC (domingo); 20 RD = 00 UTC (lunes).
do $$ begin perform cron.unschedule('sgc-recordatorio-reporte-semanal-dia'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('sgc-recordatorio-reporte-semanal-noche'); exception when others then null; end $$;
select cron.schedule('sgc-recordatorio-reporte-semanal-dia', '0 12,15,18,21 * * 0',
  $cron$ select sgc.recordatorio_reporte_semanal(); $cron$);
select cron.schedule('sgc-recordatorio-reporte-semanal-noche', '0 0 * * 1',
  $cron$ select sgc.recordatorio_reporte_semanal(); $cron$);
