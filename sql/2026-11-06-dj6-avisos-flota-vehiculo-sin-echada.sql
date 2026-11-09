-- Issue #55 -- sgc.avisos_flota_tipo_chk nunca incluyo 'vehiculo_sin_echada'
-- (agregado como tipo valido en sql/2026-09-15-br1-combustible-acepta-y-avisa.sql
-- junto con su entrada en el catalogo de notificaciones, pero el CHECK de la
-- tabla no se actualizo en esa migracion). El cron sgc-vehiculos-sin-echada
-- falla 4 de cada 7 dias con "avisos_flota_tipo_chk" -- Flota nunca se entera.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add constraint avisos_flota_tipo_chk check (tipo = any (array[
  'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido','consumo_anormal',
  'licencia','matricula','seguro','reporte_semanal','conciliacion',
  'licencia_por_vencer','licencia_vencida','matricula_por_vencer','matricula_vencida',
  'seguro_por_vencer','seguro_vencida','pp_por_vencer','pp_vencida',
  'mantenimiento_por_revisar','novedad','revisar_lectura',
  'vehiculo_sin_echada'
]));

commit;
