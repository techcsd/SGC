-- ============================================================================
-- Mejoras 14/07/2026 — R3 Reporte semanal de vehículo
-- ----------------------------------------------------------------------------
-- Usa la infraestructura de checklists (plantilla con frecuencia='semanal').
-- Aditivo/retrocompatible: las plantillas existentes quedan frecuencia='preuso'.
--   1. Columna checklist_plantillas.frecuencia
--   2. Seed plantilla "Reporte semanal de vehículo" (8 datos, TODO negocio §5)
--   3. Vista sgc.v_reporte_semanal_cumplimiento (12 semanas ISO x vehículo)
-- ============================================================================

set search_path = sgc, public;

-- 1) Frecuencia de la plantilla (preuso | semanal | otro).
alter table sgc.checklist_plantillas
  add column if not exists frecuencia text not null default 'preuso';
do $$ begin
  alter table sgc.checklist_plantillas
    add constraint checklist_plantillas_frecuencia_chk
    check (frecuencia in ('preuso','semanal','mensual','otro'));
exception when duplicate_object then null; end $$;

-- 2) Seed plantilla semanal (idempotente por codigo).
-- TODO negocio (§5): confirmar las preguntas exactas y cuáles son críticas.
-- El reporte captura además: kilometraje, nivel de combustible y observaciones
-- (campos de la cabecera del checklist), completando las 8 "preguntas".
do $$
declare v_pid uuid;
begin
  select id into v_pid from sgc.checklist_plantillas where codigo = 'REPORTE-SEMANAL-V1';
  if v_pid is null then
    insert into sgc.checklist_plantillas (codigo, nombre, categoria, descripcion, activo, orden, frecuencia)
    values ('REPORTE-SEMANAL-V1', 'Reporte semanal de vehículo', 'general',
            'Chequeo semanal rápido del estado del vehículo (5-8 puntos esenciales).',
            true, 100, 'semanal')
    returning id into v_pid;

    insert into sgc.checklist_plantilla_items (plantilla_id, seccion, etiqueta, es_critico, orden, numero, aplica_a) values
      (v_pid, 'semanal', '¿Luces funcionando correctamente?',                     false, 1, '1', 'Ambos'),
      (v_pid, 'semanal', '¿Neumáticos en buen estado (incluye repuesto)?',        false, 2, '2', 'Ambos'),
      (v_pid, 'semanal', '¿Frenos en buen estado?',                               true,  3, '3', 'Ambos'),
      (v_pid, 'semanal', '¿Sin fugas de líquidos (aceite, agua, frenos)?',        false, 4, '4', 'Ambos'),
      (v_pid, 'semanal', '¿Limpieza y estado general OK?',                        false, 5, '5', 'Ambos');
  end if;
end $$;

-- 3) Cumplimiento semanal: últimas 12 semanas ISO x vehículo activo, con el
-- chofer asignado y si tiene reporte semanal esa semana.
create or replace view sgc.v_reporte_semanal_cumplimiento
with (security_invoker = true) as
with semanas as (
  select (date_trunc('week', current_date)::date - (n * 7)) as semana_inicio
    from generate_series(0, 11) as n
),
veh as (
  select id, placa, responsable_id
    from sgc.vehiculos
   where coalesce(activo, true) and estado <> 'baja'
),
asignado as (
  select distinct on (va.vehiculo_id)
         va.vehiculo_id, va.usuario_id, u.nombre as chofer_nombre
    from sgc.vehiculo_asignaciones va
    left join sgc.usuarios u on u.id = va.usuario_id
   where va.activa
   order by va.vehiculo_id, va.desde desc
)
select
  extract(isoyear from s.semana_inicio)::int          as anio,
  extract(week    from s.semana_inicio)::int          as semana,
  s.semana_inicio,
  (s.semana_inicio + 6)                               as semana_fin,
  v.id                                                as vehiculo_id,
  v.placa,
  coalesce(a.chofer_nombre, ru.nombre)                as chofer_nombre,
  coalesce(a.usuario_id, v.responsable_id)            as chofer_usuario_id,
  ck.id                                               as checklist_id,
  ck.fecha                                            as reporte_fecha,
  ck.resultado,
  (ck.id is not null)                                 as tiene_reporte
from semanas s
cross join veh v
left join asignado a  on a.vehiculo_id = v.id
left join sgc.usuarios ru on ru.id = v.responsable_id
left join lateral (
  select c.id, c.fecha, c.resultado
    from sgc.checklists_vehiculo c
    join sgc.checklist_plantillas p on p.id = c.plantilla_id
   where c.vehiculo_id = v.id
     and p.frecuencia = 'semanal'
     and c.fecha >= s.semana_inicio
     and c.fecha <  s.semana_inicio + 7
   order by c.fecha desc
   limit 1
) ck on true;
grant select on sgc.v_reporte_semanal_cumplimiento to authenticated, service_role;

-- 4) Permitir el tipo de aviso 'reporte_semanal' (recordatorio a faltantes).
alter table sgc.avisos_flota drop constraint if exists avisos_flota_tipo_chk;
alter table sgc.avisos_flota add constraint avisos_flota_tipo_chk check (tipo in (
  'bloqueo_critico','hallazgos','pre_cita','mantenimiento_vencido',
  'consumo_anormal','licencia','matricula','seguro','reporte_semanal'));
