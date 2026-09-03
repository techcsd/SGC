-- ════════════════════════════════════════════════════════════════════════════
-- BH (limpieza de campo) — Silenciar el ruido del watchdog en el panel de errores.
--
-- El grupo `watchdog: sin fixes recientes, re-armando watcher` tenía 306 ocurrencias
-- (~48% del panel de Tecnología) — un watchdog re-armándose a sí mismo NO es
-- telemetría accionable, es ruido que tapa lo que sí importa. Como report_app_error
-- REABRE por firma (auto-reapertura AW14), marcarlo "solucionado" no lo silencia:
-- se descarta en el INGEST. (Las 306 filas viejas ya se borraron en un paso aparte.)
--
-- Se suprime SOLO ese patrón de auto-loop; los errores reales del watcher
-- (`watcher nativo devolvió error`) y de sync (`registrar_posiciones rechazó el lote`)
-- SÍ se siguen registrando — esos son accionables. El fix de raíz (que la app deje
-- de reportarlo como error) va en el lado app (PROMPT-31); esto es la red server-side.
-- Aditivo/retrocompatible: misma firma, solo agrega el filtro de ruido.
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

create or replace function sgc.report_app_error(p_error_type text, p_message text, p_stack text default null::text, p_context jsonb default '{}'::jsonb, p_device_model text default null::text, p_device_brand text default null::text, p_os_version text default null::text, p_app_version text default null::text, p_platform text default null::text, p_source text default 'app'::text)
 returns uuid
 language plpgsql security definer
 set search_path to 'sgc', 'public'
as $function$
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

  -- BH — ruido conocido: el watchdog re-armándose no es telemetría (tapaba el panel).
  -- Se descarta en silencio; los errores REALES del watcher/sync sí se registran.
  if lower(coalesce(p_message, '')) like 'watchdog:%re-armando watcher%' then
    return null;
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
$function$;

commit;
