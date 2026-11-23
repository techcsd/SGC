-- DX3 (ronda 23-nov-2026) -- «Pulso del sistema» resiliente + filas nuevas.
--
-- Diagnóstico F0 (prod, solo lectura): la RPC original SÍ corre sana (cron.job_run_details = 57 k filas,
-- consulta de crons 54 ms, resto < 3 ms, grants OK, mismo cuerpo que en dev) → la hipótesis «timeout por
-- el join a cron.job_run_details» NO se confirmó. Lo que sí es un defecto de diseño: todo el pulso vive en
-- UNA función, así que cualquier tabla/política/consulta lenta tumba las seis filas a la vez.
--
-- Cambios (contrato de columnas intacto: sistema, estado, detalle, ultima_actividad):
--  (a) cron.job_run_details solo de las últimas 24 h, sin left join a toda la tabla;
--  (b) CADA bloque en su BEGIN … EXCEPTION: una fila rota sale como estado `desconocido` con el código
--      real («No se pudo leer: 42501»), no cae toda la RPC;
--  (c) statement_timeout de 4 s por bloque (set_config local);
--  (d) filas nuevas: «Servicio de IA», «Correos de requisiciones», «Sincronización con Odoo».
-- Aditivo y reversible (sql/_reversa/2026-11-23-dx3-pulso-resiliente.reversa.sql).
begin;
set local lock_timeout = '3s';

create or replace function sgc.pulso_sistema()
returns table(sistema text, estado text, detalle text, ultima_actividad timestamptz)
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $function$
declare
  v_ts timestamptz;
  v_n integer;
  v_m integer;
  v_k integer;
  v_txt text;
  v_arr text[];
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  -- 1) Base de datos
  begin
    perform set_config('statement_timeout', '4s', true);
    return query select 'Base de datos'::text, 'activo'::text, 'En línea (sin reinicios recientes)'::text, pg_postmaster_start_time();
  exception when others then
    return query select 'Base de datos'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 2) Funciones programadas (crons) — solo 24 h, agregado por job, NUNCA el texto del comando.
  begin
    perform set_config('statement_timeout', '4s', true);
    select count(*) into v_n from cron.job;
    select max(d.start_time) into v_ts from cron.job_run_details d where d.start_time > now() - interval '24 hours';
    select array_agg(distinct j.jobname order by j.jobname) into v_arr
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.start_time > now() - interval '24 hours';
    return query select 'Funciones programadas'::text,
      case when v_arr is not null and array_length(v_arr, 1) > 0 then 'error'
           when v_ts is null or v_ts < now() - interval '6 hours' then 'sin_actividad'
           else 'activo' end,
      case when v_arr is not null and array_length(v_arr, 1) > 0 then format('Fallaron en las últimas 24h: %s', array_to_string(v_arr, ', '))
           else format('%s tareas programadas activas', v_n) end,
      v_ts;
  exception when others then
    return query select 'Funciones programadas'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 3) Cola de envíos (outbox)
  begin
    perform set_config('statement_timeout', '4s', true);
    select count(*), max(ultima_vez), count(*) filter (where ultima_vez < now() - interval '2 hours')
      into v_n, v_ts, v_m from sgc.outbox_atascados where not resuelto;
    return query select 'Cola de envíos'::text,
      case when v_m > 0 then 'error' when v_n > 0 then 'atencion' else 'activo' end,
      case when v_n = 0 then 'Sin envíos atascados' else format('%s envío(s) atascado(s) sin resolver', v_n) end,
      v_ts;
  exception when others then
    return query select 'Cola de envíos'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 4) Voz a texto
  begin
    perform set_config('statement_timeout', '4s', true);
    select max(created_at), count(*) filter (where transcripcion_estado = 'procesando' and created_at < now() - interval '30 minutes')
      into v_ts, v_n from sgc.audio_notas where transcripcion_estado is not null;
    return query select 'Voz a texto'::text,
      case when v_n > 0 then 'error' when v_ts is null or v_ts < now() - interval '6 hours' then 'sin_actividad' else 'activo' end,
      case when v_n > 0 then 'Hay transcripciones atascadas (el Vigía ya las reintenta)'
           when v_ts is null then 'Sin notas de voz registradas todavía' else 'Transcripciones al día' end,
      v_ts;
  exception when others then
    return query select 'Voz a texto'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 5) Lectores de IA (uso por recencia; el éxito/fallo real va en «Servicio de IA»)
  begin
    perform set_config('statement_timeout', '4s', true);
    select max(created_at), count(*) filter (where created_at > now() - interval '24 hours') into v_ts, v_n from sgc.uso_ia;
    return query select 'Lectores de IA'::text,
      case when v_ts is null or v_ts < now() - interval '24 hours' then 'sin_actividad' else 'activo' end,
      format('%s uso(s) de IA en las últimas 24h', coalesce(v_n, 0)), v_ts;
  exception when others then
    return query select 'Lectores de IA'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 6) GPS
  begin
    perform set_config('statement_timeout', '4s', true);
    select max(capturado_en) into v_ts from sgc.chofer_ultima_posicion;
    return query select 'GPS'::text,
      case when v_ts is null or v_ts < now() - interval '2 hours' then 'sin_actividad' else 'activo' end,
      case when v_ts is null then 'Sin posiciones registradas todavía' else 'Última posición recibida' end, v_ts;
  exception when others then
    return query select 'GPS'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 7) DX1 — Servicio de IA: fallos reales (error_reports `ia:<código> · <función>`) vs. último uso OK (uso_ia).
  begin
    perform set_config('statement_timeout', '4s', true);
    select count(*), max(created_at) into v_n, v_ts from sgc.app_error_reports
     where message like 'ia:%' and created_at > now() - interval '24 hours';
    select string_agg(distinct split_part(split_part(message, ' · ', 1), ':', 2), ', ') into v_txt from sgc.app_error_reports
     where message like 'ia:%' and created_at > now() - interval '24 hours';
    return query select 'Servicio de IA'::text,
      case when v_n > 0 then 'error' else 'activo' end,
      case when v_n > 0 then format('%s fallo(s) de IA en 24 h (%s)', v_n, coalesce(v_txt, '?'))
           else 'Sin fallos de IA registrados en 24 h' end,
      coalesce(v_ts, (select max(created_at) from sgc.uso_ia));
  exception when others then
    return query select 'Servicio de IA'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 8) DX4 — Correos de requisiciones/compras (24 h): enviados / omitidos / fallidos.
  begin
    perform set_config('statement_timeout', '4s', true);
    select count(*) filter (where n.estado = 'enviada'), count(*) filter (where n.estado = 'omitida'),
           count(*) filter (where n.estado = 'fallida'), max(n.created_at)
      into v_n, v_m, v_k, v_ts
      from sgc.notif_entregas n
     where n.canal = 'email' and n.tipo in ('solicitud_material', 'solicitud_compra') and n.created_at > now() - interval '24 hours';
    return query select 'Correos de requisiciones'::text,
      case when v_k > 0 then 'error' else 'activo' end,
      format('%s enviados · %s omitidos · %s fallidos (24 h)', v_n, v_m, v_k), v_ts;
  exception when others then
    return query select 'Correos de requisiciones'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;

  -- 9) DX12 — Sincronización con Odoo: último intento OK, errores 24 h, conduces degradados.
  begin
    perform set_config('statement_timeout', '4s', true);
    select max(finalizado_en) filter (where estado_resultado = 'ok'),
           count(*) filter (where estado_resultado <> 'ok' and reclamado_en > now() - interval '24 hours')
      into v_ts, v_n from sgc.odoo_intentos where reclamado_en > now() - interval '7 days';
    select count(*) into v_m from sgc.odoo_conduces_degradados;
    return query select 'Sincronización con Odoo'::text,
      case when v_m > 0 then 'atencion'
           when v_ts is null or v_ts < now() - interval '2 hours' then 'sin_actividad' else 'activo' end,
      format('%s intento(s) con error en 24 h · %s conduce(s) en modo degradado', coalesce(v_n, 0), coalesce(v_m, 0)), v_ts;
  exception when others then
    return query select 'Sincronización con Odoo'::text, 'desconocido'::text, format('No se pudo leer: %s', sqlstate), null::timestamptz;
  end;
end;
$function$;

revoke all on function sgc.pulso_sistema() from public, anon;
grant execute on function sgc.pulso_sistema() to authenticated;
comment on function sgc.pulso_sistema() is
  'DX3 — pulso por sistema; cada bloque aislado (estado `desconocido` + SQLSTATE si falla) y con statement_timeout de 4 s. Gate: is_admin() o es_tecnologia().';
commit;
