-- Reversa DX3: restaura sgc.pulso_sistema() a la definición previa (ronda DF, capturada de prod el 23-nov-2026).
begin;
CREATE OR REPLACE FUNCTION sgc.pulso_sistema()
 RETURNS TABLE(sistema text, estado text, detalle text, ultima_actividad timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sgc', 'public'
AS $function$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  -- 1) Base de datos — lo único honesto sin montar un panel de métricas real.
  return query
    select 'Base de datos'::text,
           'activo'::text,
           'En línea (sin reinicios recientes)'::text,
           pg_postmaster_start_time();

  -- 2) Funciones programadas (crons) — agregado de cron.job_run_details, NUNCA
  --    el texto del comando. Error solo si alguna corrida reciente (24h) falló
  --    de verdad; sin corridas en 6h = sin_actividad (gris), no caído.
  return query
    with ultima_por_job as (
      select j.jobname,
             max(d.start_time) as ultima_corrida,
             bool_or(d.status = 'failed' and d.start_time > now() - interval '24 hours') as fallo_reciente
      from cron.job j
      left join cron.job_run_details d on d.jobid = j.jobid
      group by j.jobname
    ),
    resumen as (
      select count(*) as total_jobs,
             max(ultima_corrida) as ultima_global,
             array_agg(jobname) filter (where fallo_reciente) as jobs_con_fallo
      from ultima_por_job
    )
    select 'Funciones programadas'::text,
           case
             when jobs_con_fallo is not null and array_length(jobs_con_fallo, 1) > 0 then 'error'
             when ultima_global is null or ultima_global < now() - interval '6 hours' then 'sin_actividad'
             else 'activo'
           end,
           case
             when jobs_con_fallo is not null and array_length(jobs_con_fallo, 1) > 0
               then format('Fallaron en las últimas 24h: %s', array_to_string(jobs_con_fallo, ', '))
             else format('%s tareas programadas activas', total_jobs)
           end,
           ultima_global
    from resumen;

  -- 3) Cola de envíos (outbox) — error real solo si hay backlog sin resolver
  --    viejo de verdad (>2h, mismo umbral que agente-vigia F3); 0 pendientes
  --    es bueno, no "sin actividad".
  return query
    with pend as (
      select count(*) as total,
             max(ultima_vez) as mas_reciente,
             bool_or(ultima_vez < now() - interval '2 hours') as hay_viejos
      from sgc.outbox_atascados
      where not resuelto
    )
    select 'Cola de envíos'::text,
           case when hay_viejos then 'error'
                when total > 0 then 'atencion'
                else 'activo' end,
           case when total = 0 then 'Sin envíos atascados'
                else format('%s envío(s) atascado(s) sin resolver', total) end,
           mas_reciente
    from pend;

  -- 4) Voz a texto (STT) — vive en audio_notas.transcripcion_estado (AA22).
  --    Error solo si hay transcripciones realmente atascadas en "procesando"
  --    por más de 30 min (mismo umbral que agente-vigia).
  return query
    with t as (
      select max(created_at) as ultima,
             bool_or(transcripcion_estado = 'procesando' and created_at < now() - interval '30 minutes') as hay_atascadas
      from sgc.audio_notas
      where transcripcion_estado is not null
    )
    select 'Voz a texto'::text,
           case when hay_atascadas then 'error'
                when ultima is null or ultima < now() - interval '6 hours' then 'sin_actividad'
                else 'activo' end,
           case when hay_atascadas then 'Hay transcripciones atascadas (el Vigía ya las reintenta)'
                when ultima is null then 'Sin notas de voz registradas todavía'
                else 'Transcripciones al día' end,
           ultima
    from t;

  -- 5) Lectores de IA — sgc.uso_ia, sin estado de éxito/fallo propio (la
  --    tabla no lo registra) → solo activo/sin_actividad por recencia.
  return query
    with u as (select max(created_at) as ultima, count(*) filter (where created_at > now() - interval '24 hours') as hoy
                from sgc.uso_ia)
    select 'Lectores de IA'::text,
           case when ultima is null or ultima < now() - interval '24 hours' then 'sin_actividad' else 'activo' end,
           format('%s uso(s) de IA en las últimas 24h', coalesce(hoy, 0)),
           ultima
    from u;

  -- 6) GPS — última posición agregada de toda la flota (no caerse si no hay
  --    nadie en ruta ahora, eso es normal fuera de horario).
  return query
    with g as (select max(capturado_en) as ultima from sgc.chofer_ultima_posicion)
    select 'GPS'::text,
           case when ultima is null or ultima < now() - interval '2 hours' then 'sin_actividad' else 'activo' end,
           case when ultima is null then 'Sin posiciones registradas todavía' else 'Última posición recibida' end,
           ultima
    from g;
end;
$function$;
revoke all on function sgc.pulso_sistema() from public, anon;
grant execute on function sgc.pulso_sistema() to authenticated;
commit;
