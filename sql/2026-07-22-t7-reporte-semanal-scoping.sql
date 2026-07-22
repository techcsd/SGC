-- ============================================================================
-- Actualización 4 — T7: scoping del cumplimiento del reporte semanal.
-- ----------------------------------------------------------------------------
-- Un chofer veía el dashboard global (16 vehículos faltantes, etc.). La vista es
-- security_invoker pero la RLS de vehiculos no restringe al chofer a los suyos,
-- así que devolvía toda la flota. Se agrega un filtro server-side: si el usuario
-- NO es rol elevado de flota, solo ve las filas de SUS vehículos (asignado o
-- responsable). Los elevados siguen viendo todo.
-- Aditivo/retrocompatible/idempotente (misma forma de la vista).
-- ============================================================================

set search_path = sgc, public;

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
) ck on true
-- T7 — scoping: los no-elevados solo ven SUS vehículos.
where sgc.es_flota_elevado()
   or coalesce(a.usuario_id, v.responsable_id) = auth.uid();

grant select on sgc.v_reporte_semanal_cumplimiento to authenticated, service_role;
