-- =============================================================================
-- PROMPT-1 FASE 6 (AK10) — Alarma dominical del reporte/inspección semanal.
-- SGC padre. Aditivo. Extiende AF8:
--   • Pre-aviso el SÁBADO 6:00 PM RD (heads-up de que mañana toca).
--   • Insistencia el DOMINGO (8/11/14/17/20 RD, cadencia AF8) con ALARMA:
--     push de alta prioridad y data.tipo='alarma-reporte-semanal' para que la app
--     dispare la alerta tipo despertador (PROMPT-2).
--   • Destinatario con el modelo nuevo AK20: quien tiene el vehículo EN USO (bridge
--     responsable_id) y, si nadie, el ÚLTIMO usuario de la semana (vehiculo_usos).
--   • es_prueba respetado; no molesta a quien ya envió el reporte.
-- =============================================================================

begin;

-- 0-arg → se reemplaza por versión con bandera de alarma (evita ambigüedad).
drop function if exists sgc.recordatorio_reporte_semanal();

create or replace function sgc.recordatorio_reporte_semanal(p_alarma boolean default false)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_anio   int := extract(isoyear from (now() at time zone 'America/Santo_Domingo'))::int;
  v_semana int := extract(week   from (now() at time zone 'America/Santo_Domingo'))::int;
  v_ini_semana timestamptz := date_trunc('week', (now() at time zone 'America/Santo_Domingo')) at time zone 'America/Santo_Domingo';
  r record;
  v_n int := 0;
begin
  for r in
    select c.vehiculo_id, c.placa,
      coalesce(
        c.chofer_usuario_id,
        (select vu.usuario_id from sgc.vehiculo_usos vu
          where vu.vehiculo_id = c.vehiculo_id and vu.inicio_at >= v_ini_semana
          order by vu.inicio_at desc limit 1)
      ) as usuario_id
    from sgc.v_reporte_semanal_cumplimiento c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    where c.anio = v_anio and c.semana = v_semana
      and not coalesce(c.tiene_reporte, false)
      and not coalesce(v.es_prueba, false)
  loop
    if r.usuario_id is null then continue; end if;

    perform sgc.notificar(
      r.usuario_id, 'warning',
      case when p_alarma then '⏰ Reporte semanal de tu vehículo' else 'Inspección de vehículo pendiente' end,
      format('%s Envía la inspección de %s desde la app.',
             case when p_alarma then 'Hazla ahora:' else 'Aún no la has enviado.' end,
             coalesce(r.placa, 'tu vehículo')),
      '/flota/reporte-semanal'
    );

    -- AK10: el domingo se manda además una push de ALARMA distinguible por data.tipo.
    if p_alarma then
      perform sgc.send_push(
        array[r.usuario_id],
        'Reporte semanal de tu vehículo',
        format('Haz ahora la inspección de %s.', coalesce(r.placa, 'tu vehículo')),
        jsonb_build_object(
          'tipo', 'alarma-reporte-semanal',
          'ruta', '/flota/reporte-semanal',
          'alarma', true,
          'vehiculo_id', r.vehiculo_id)
      );
    end if;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
grant execute on function sgc.recordatorio_reporte_semanal(boolean) to authenticated, service_role;

-- ── Reprogramación de crons (hora RD = UTC-4) ────────────────────────────────
-- Pre-aviso SÁBADO 18:00 RD (22:00 UTC), sin alarma.
select cron.schedule('sgc-preaviso-reporte-semanal-sabado', '0 22 * * 6',
  $$select sgc.recordatorio_reporte_semanal(false);$$);

-- Insistencia DOMINGO con ALARMA (8/11/14/17 RD = 12/15/18/21 UTC).
select cron.schedule('sgc-recordatorio-reporte-semanal-dia', '0 12,15,18,21 * * 0',
  $$select sgc.recordatorio_reporte_semanal(true);$$);

-- Cierre DOMINGO 20:00 RD (00:00 UTC lunes) con ALARMA.
select cron.schedule('sgc-recordatorio-reporte-semanal-noche', '0 0 * * 1',
  $$select sgc.recordatorio_reporte_semanal(true);$$);

commit;
