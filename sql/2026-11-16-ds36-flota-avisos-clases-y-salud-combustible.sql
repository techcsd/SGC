-- DS-36/DS-37 (ronda DS, 16-nov-2026) — #61 avisos de flota accionables vs informativos; #60 salud de combustible.
-- Aditiva. Lo que se lee de los 5 crons (ver docs/avance-lotes/F8abc.md): NO se solapan. Solo
-- `sgc-reporte-semanal-dia` inserta en avisos_flota (los 396 reporte_semanal); los demas (preaviso sabado,
-- recordatorio dia/noche, resumen-operaciones-lunes) son notificaciones/correos, no avisos. Por eso no se
-- consolida ningun cron: se separa la CLASE del aviso y se auto-resuelve al enviar el reporte.
--   node scripts/apply-migration.mjs sql/2026-11-16-ds36-flota-avisos-clases-y-salud-combustible.sql --env dev
begin;
set local search_path = sgc, public;

insert into sgc.parametros (clave, valor, descripcion) values
  ('avisos_flota_informativos', 'reporte_semanal', 'DS-36/#61: tipos de aviso de flota que son INFORMATIVOS (no accionables), CSV. La lista de Avisos los oculta por defecto y los resume en una sola linea.'),
  ('avisos_flota_autoresolver_reporte', 'true', 'DS-36/#61: al registrar el checklist semanal de un vehiculo, los avisos reporte_semanal pendientes de ese vehiculo se marcan atendidos solos.'),
  ('combustible_importacion_dias_alerta', '21', 'DS-37/#60: dias sin echadas importadas tras los que flota_salud_combustible() marca la importacion como caida.')
on conflict (clave) do nothing;

-- ── #61: auto-resolver el recordatorio cuando el reporte se envia ───────────────────────
create or replace function sgc.tg_autoresolver_aviso_reporte_semanal()
returns trigger
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if coalesce((select valor from sgc.parametros where clave = 'avisos_flota_autoresolver_reporte'), 'true') not in ('true','t','1','si','sí') then
    return new;
  end if;
  if exists (select 1 from sgc.checklist_plantillas p where p.id = new.plantilla_id and p.frecuencia = 'semanal') then
    update sgc.avisos_flota a set estado = 'atendido', atendido_at = now(),
           nota_atencion = coalesce(a.nota_atencion, 'Reporte semanal recibido (automatico)')
     where a.vehiculo_id = new.vehiculo_id and a.tipo = 'reporte_semanal' and a.estado = 'pendiente';
  end if;
  return new;
end $$;
drop trigger if exists tg_autoresolver_aviso_reporte_semanal on sgc.checklists_vehiculo;
create trigger tg_autoresolver_aviso_reporte_semanal
  after insert on sgc.checklists_vehiculo
  for each row execute function sgc.tg_autoresolver_aviso_reporte_semanal();

-- ── #61: resumen unico (accionables vs informativos) para la cabecera de Avisos ───────────
create or replace function sgc.avisos_flota_resumen()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with inf as (select unnest(sgc.param_csv('avisos_flota_informativos', 'reporte_semanal')) as tipo),
  base as (
    select a.tipo, a.created_at, (a.tipo in (select tipo from inf)) as informativo
      from sgc.avisos_flota a
     where a.estado = 'pendiente' and not coalesce(a.es_prueba, false)
       and (sgc.is_admin() or sgc.tiene_modulo('flota'))
  )
  select jsonb_build_object(
    'accionables_pendientes', count(*) filter (where not informativo),
    'informativos_pendientes', count(*) filter (where informativo),
    'informativo_mas_antiguo_dias', coalesce(max(extract(day from now() - created_at)::int) filter (where informativo), 0))
    from base;
$$;
grant execute on function sgc.avisos_flota_resumen() to authenticated;

-- ── #60: salud de la importacion de estacion y calidad de km (solo lectura) ───────────────
create or replace function sgc.flota_salud_combustible()
returns jsonb
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case when sgc.is_admin() or sgc.tiene_modulo('flota') then
    jsonb_build_object(
      'registros_total', count(*),
      'km_pendiente_pct', case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where r.km_pendiente) / count(*), 1) end,
      'importadas_total', count(*) filter (where r.importada),
      'ultima_importada', max(r.fecha) filter (where r.importada),
      'dias_sin_importar', (current_date - max(r.fecha) filter (where r.importada)),
      'importacion_caida', coalesce(
        (current_date - max(r.fecha) filter (where r.importada)) >
          coalesce(nullif((select valor from sgc.parametros where clave = 'combustible_importacion_dias_alerta'), '')::int, 21), true),
      'registros_ultimos_30d', count(*) filter (where r.fecha >= current_date - 30))
  else '{}'::jsonb end
    from sgc.registros_combustible r
   where not coalesce(r.es_prueba, false);
$$;
grant execute on function sgc.flota_salud_combustible() to authenticated;
commit;
