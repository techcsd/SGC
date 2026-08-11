-- =============================================================================
-- PROMPT-3 FASE 6 (AL6) — Alarma dominical AUTÓNOMA: arranca DOMINGO 9:00 AM RD,
-- reinsiste cada 30 min hasta las 20:00 RD, hasta que se haga la inspección.
-- Refina AK10. SGC padre. Aditivo, idempotente.
--
-- Cambios:
--   • Cadencia: domingo 09:00→19:30 RD cada 30 min (antes 8/11/14/17) + cierre
--     20:00 RD. La insistencia se CORTA sola en cuanto el usuario envía el reporte
--     (la vista v_reporte_semanal_cumplimiento deja de listarlo: tiene_reporte).
--   • Payload de ALARMA para la app (PROMPT-4): data.tipo='alarm-weekly-inspection'
--     (alarma nativa full-screen), alarma=true, prioridad alta, channel_id dedicado.
--   • Destinatario = quien tiene el vehículo EN USO; si nadie, el último de la
--     semana (AK20). es_prueba respetado.
-- =============================================================================

begin;

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
      case when p_alarma then '⏰ Inspección de tu vehículo' else 'Inspección de vehículo pendiente' end,
      format('%s Envía la inspección de %s desde la app.',
             case when p_alarma then 'Hazla ahora:' else 'Aún no la has enviado.' end,
             coalesce(r.placa, 'tu vehículo')),
      '/flota/reporte-semanal'
    );

    -- AL6: push de ALARMA (domingo). La app dispara alarma nativa full-screen.
    if p_alarma then
      perform sgc.send_push(
        array[r.usuario_id],
        'Inspección de tu vehículo',
        format('Haz ahora la inspección de %s. Sonará hasta que la completes.', coalesce(r.placa, 'tu vehículo')),
        jsonb_build_object(
          'tipo', 'alarm-weekly-inspection',       -- AL6 canónico para la alarma nativa
          'legacy_tipo', 'alarma-reporte-semanal', -- retrocompat AK10
          'ruta', '/flota/reporte-semanal',
          'alarma', true,
          'prioridad', 'alta',
          'channel_id', 'alarma_inspeccion',
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
-- Pre-aviso SÁBADO 18:00 RD (22:00 UTC), sin alarma (heads-up).
select cron.schedule('sgc-preaviso-reporte-semanal-sabado', '0 22 * * 6',
  $$select sgc.recordatorio_reporte_semanal(false);$$);

-- AL6 — Insistencia DOMINGO cada 30 min de 09:00 a 19:30 RD (13:00–23:30 UTC) con ALARMA.
select cron.schedule('sgc-recordatorio-reporte-semanal-dia', '*/30 13-23 * * 0',
  $$select sgc.recordatorio_reporte_semanal(true);$$);

-- Cierre DOMINGO 20:00 RD (00:00 UTC lunes) con ALARMA.
select cron.schedule('sgc-recordatorio-reporte-semanal-noche', '0 0 * * 1',
  $$select sgc.recordatorio_reporte_semanal(true);$$);

commit;
