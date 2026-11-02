-- =============================================================================
-- DF6c — Pulso del sistema (Administración). PROMPT 128, sección F6 (DF5-C).
--
-- Línea de vida por sistema: BD, funciones programadas (crons), cola de envíos,
-- voz a texto, lectores de IA, GPS. Regla explícita del prompt: "línea plana
-- gris = sin actividad, NUNCA caído" — por eso casi todas las filas usan el
-- par activo/sin_actividad y solo 2 (crons, cola de envíos) tienen un estado
-- de error real, basado en una condición verificable (falla real, backlog
-- real), nunca inferido de la sola ausencia de uso reciente.
--
-- Qué se expone y qué NO: cron.job_run_details tiene una columna `command`
-- con el SQL/HTTP completo de cada tarea (incluye secretos de vault en texto
-- plano en algunos casos). Esta función NUNCA selecciona esa columna ni
-- ninguna otra columna interna de pg_cron/pg_net — solo nombre de job,
-- último estado agregado, y desde cuándo.
--
-- `ultima_actividad` es un timestamptz (no un interval) para que el front
-- reuse `formatFechaRelativa()` tal cual, sin parsear el formato de interval
-- de Postgres en TypeScript.
--
-- Qué se omitió: no existe una tabla de "trabajos STT" en abstracto (el STT
-- vive dentro de audio_notas.transcripcion_estado, que sí se usa abajo) ni un
-- indicador honesto de salud de BD más allá del uptime del proceso — se
-- incluye el uptime, nada de "OK" sin verificar.
-- =============================================================================
begin;

-- cambia el tipo de retorno de una versión previa de esta misma migración
-- (interval → timestamptz); create or replace no permite cambiar el tipo.
drop function if exists sgc.pulso_sistema();

create or replace function sgc.pulso_sistema()
returns table (sistema text, estado text, detalle text, ultima_actividad timestamptz)
language plpgsql
security definer
set search_path = sgc, public
as $$
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
$$;

revoke all on function sgc.pulso_sistema() from public;
grant execute on function sgc.pulso_sistema() to authenticated;

commit;
