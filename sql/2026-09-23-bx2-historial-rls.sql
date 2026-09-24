-- BX2 — El historial de edición de una echada se ve crudo (uuid, ISO, [object Object])
-- y hay que revisar la exposición. La RLS actual (bq3-bq5) ya restringe el historial a
-- `es_flota_elevado()` — un chofer no ve NADA de su propia echada. DEFAULT: que el chofer
-- vea el historial DE SUS echadas (para que la app pueda mostrárselo, en lenguaje humano),
-- y los referentes de flota, todas. La legibilidad la resuelve el frontend (diff humano);
-- aquí solo se amplía el acceso del chofer a lo suyo.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-23-bx2-historial-rls.sql --env dev  →  --env prod
-- Rollback: create policy rc_hist_select ... using (sgc.es_flota_elevado());  (política anterior)
begin;

drop policy if exists rc_hist_select on sgc.registros_combustible_historial;
create policy rc_hist_select on sgc.registros_combustible_historial
  for select to authenticated using (
    sgc.es_flota_elevado()
    or exists (
      select 1 from sgc.registros_combustible rc
      left join sgc.conductores c on c.id = rc.conductor_id
      where rc.id = registros_combustible_historial.registro_id
        and (rc.registrado_por = auth.uid() or c.usuario_id = auth.uid())
    )
  );

commit;
