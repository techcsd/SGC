-- =============================================================================
-- PROMPT-25 FASE 3 (BE1) — Cron del lunes + reenvío manual del resumen de
-- operaciones. Ronda 19/08-01/09/2026 (IDs BE). Aditivo, idempotente.
--
-- ⚠️ ESTADO: el edge `resumen-semanal-operaciones` YA está desplegado y las dos
-- funciones (enviar_semana + cron_lunes) YA están aplicadas en prod (para que el
-- botón "Reenviar" funcione en las pruebas). Lo ÚNICO pendiente de esta migración
-- es el `cron.schedule` del final — programar el envío automático de los lunes.
-- Se dejó para el GO de Xaviel (no arrancar el correo automático sin su visto bueno).
-- Aplicar el archivo completo es idempotente (re-crea las funciones + programa el cron).
--
-- Patrón AT2/Y17 (idéntico al incentivo): pg_net + shared-secret `x-sync-secret`
-- desde el vault. Lunes 7:00 AM RD = 11:00 UTC (horario confirmado con Xaviel).
-- =============================================================================

begin;

-- Invoca el edge para una semana. Gate: es_tecnologia/admin (reenvío manual) o
-- auth.uid() null (cron/service). Idempotente: no reenvía si ya salió OK, salvo forzar.
create or replace function sgc.resumen_operaciones_enviar_semana(
  p_anio int, p_semana int, p_forzar boolean default false
) returns text
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare v_url text; v_secret text; v_ya boolean;
begin
  if not (sgc.es_tecnologia() or sgc.is_admin() or auth.uid() is null) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select exists(select 1 from sgc.resumen_operaciones_envio
                where anio = p_anio and semana = p_semana and ok) into v_ya;
  if v_ya and not p_forzar then return 'ya_enviado'; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  v_url := 'https://jeeqhgccqefbqilntcpu.supabase.co/functions/v1/resumen-semanal-operaciones';
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('anio', p_anio, 'semana', p_semana));
  return 'enviando';
end;
$$;
grant execute on function sgc.resumen_operaciones_enviar_semana(int, int, boolean)
  to authenticated, service_role;

-- Cron de los lunes: última semana ISO cerrada (hoy - 7, en hora RD).
create or replace function sgc.resumen_operaciones_cron_lunes()
returns void
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int  := extract(isoyear from v_ref)::int;
  v_sem  int  := extract(week from v_ref)::int;
begin
  perform sgc.resumen_operaciones_enviar_semana(v_anio, v_sem, false);
end;
$$;
grant execute on function sgc.resumen_operaciones_cron_lunes() to service_role;

-- Programa el cron (lunes 11:00 UTC = 7:00 AM RD). Idempotente.
do $$ begin perform cron.unschedule('sgc-resumen-operaciones-lunes'); exception when others then null; end $$;
select cron.schedule('sgc-resumen-operaciones-lunes', '0 11 * * 1',
  $cron$ select sgc.resumen_operaciones_cron_lunes(); $cron$);

commit;
