-- CW4 — Correo semanal del reporte de rendimiento por vehículo (Eduardo + Flota).
-- Nueva familia en sgc.envios_automaticos (patrón CT10/CU3): nace APAGADA en
-- TODOS los entornos (D7, CONTEXTO-56 §4) — a diferencia de las familias viejas
-- de CT10 que heredaron su estado por entorno, esta es nueva y nadie la ha
-- encendido todavía; Xaviel decide cuándo con el interruptor del panel.
--
--   node scripts/apply-migration.mjs sql/2026-10-23-cw4-rendimiento-correo-semanal.sql --env dev
-- -------------------------------------------------------------------------------------
begin;
set local search_path = sgc, public;

insert into sgc.envios_automaticos (familia, nombre, activo) values
  ('rendimiento_vehiculos', 'Rendimiento semanal por vehículo', false)
on conflict (familia) do nothing;

-- ── Destinatarios: Eduardo + Flota (roles configurables, mismo patrón de param_csv) ──
create or replace function sgc.destinatarios_rendimiento_vehiculos()
returns table(email text, nombre text)
language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $function$
  select distinct u.email, u.nombre
  from sgc.usuarios u
  join sgc.usuarios_roles ur on ur.usuario_id = u.id
  join sgc.roles r on r.id = ur.rol_id
  where coalesce(u.activo, true)
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and r.codigo = any (sgc.param_csv('rendimiento_vehiculos_roles','direccion,jefe_flota,logistica'))
    and coalesce((select 'email' = any(canales) and activo from sgc.notif_tipo where tipo='rendimiento_vehiculos'), true)
    and sgc.notif_permitida(u.id, 'rendimiento_vehiculos');
$function$;
grant execute on function sgc.destinatarios_rendimiento_vehiculos() to authenticated, service_role;

-- ── Invoca el edge (semana ya cerrada = lunes-domingo anterior). Idempotente por
-- diseño simple (no hay tabla de "ya enviado"; el gate es envio_automatico_activo). ──
create or replace function sgc.rendimiento_vehiculos_enviar_semana(
  p_desde date, p_hasta date, p_destinatario_prueba text default null
) returns text
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare v_secret text;
begin
  if not (sgc.es_tecnologia() or sgc.is_admin() or auth.uid() is null) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    raise exception 'Falta el secreto infra_sync_secret en este entorno.' using errcode = '22023';
  end if;

  perform net.http_post(
    url := sgc.edge_url('reporte-rendimiento-semanal'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'destinatario_prueba', p_destinatario_prueba));
  return 'enviando';
end;
$$;
grant execute on function sgc.rendimiento_vehiculos_enviar_semana(date, date, text) to authenticated, service_role;

create or replace function sgc.rendimiento_vehiculos_cron_lunes()
returns void
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_hasta date := (now() at time zone 'America/Santo_Domingo')::date - 1;
  v_desde date := v_hasta - 6;
begin
  if not sgc.envio_automatico_activo('rendimiento_vehiculos') then return; end if;
  perform sgc.rendimiento_vehiculos_enviar_semana(v_desde, v_hasta, null);
  perform sgc.envio_automatico_marcar_enviado('rendimiento_vehiculos');
end;
$$;
grant execute on function sgc.rendimiento_vehiculos_cron_lunes() to service_role;

do $$ begin perform cron.unschedule('sgc-rendimiento-vehiculos-lunes'); exception when others then null; end $$;
select cron.schedule('sgc-rendimiento-vehiculos-lunes', '0 11 * * 1',
  $cron$ select sgc.rendimiento_vehiculos_cron_lunes(); $cron$);

-- ── "Enviar prueba ahora" (CU3): la nueva familia entra al mismo switchboard ──
create or replace function sgc.envio_automatico_probar(p_familia text) returns text
language plpgsql security definer
set search_path to 'sgc', 'public'
as $$
declare
  v_email  text;
  v_secret text;
  v_url    text;
  v_anio   int := extract(isoyear from current_date)::int;
  v_sem    int := extract(week from current_date)::int;
  v_hasta  date := current_date;
  v_desde  date := current_date - 6;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede probar un envío automático.' using errcode = '42501';
  end if;

  select email into v_email from sgc.usuarios where id = auth.uid();
  if nullif(trim(coalesce(v_email, '')), '') is null then
    raise exception 'Tu usuario no tiene un correo configurado — no se puede mandar la prueba.' using errcode = '22023';
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';
  if v_secret is null then
    raise exception 'Falta el secreto infra_sync_secret en este entorno — no se puede llamar a la edge.' using errcode = '22023';
  end if;

  if p_familia = 'resumen_operaciones' then
    v_url := sgc.edge_url('resumen-semanal-operaciones');
    perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
      body := jsonb_build_object('anio', v_anio, 'semana', v_sem, 'destinatario_prueba', v_email));
  elsif p_familia = 'incentivo_semanal' then
    v_url := sgc.edge_url('incentivo-semanal');
    perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
      body := jsonb_build_object('anio', v_anio, 'semana', v_sem, 'destinatario_prueba', v_email));
  elsif p_familia = 'rendimiento_vehiculos' then
    v_url := sgc.edge_url('reporte-rendimiento-semanal');
    perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
      body := jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'destinatario_prueba', v_email));
  else
    raise exception 'Esta familia no tiene "enviar prueba ahora" — es un aviso interno, no un correo a una lista fija.' using errcode = '22023';
  end if;

  return v_email;
end;
$$;
grant execute on function sgc.envio_automatico_probar(text) to authenticated;

commit;
