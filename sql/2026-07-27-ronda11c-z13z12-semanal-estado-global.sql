-- ============================================================================
-- RONDA 11c · Z13 + Z12 — Reporte semanal: estado GLOBAL por vehículo + autor
-- ----------------------------------------------------------------------------
-- Z13a — El estado "reportado esta semana" es por VEHÍCULO (no por usuario). La
-- vista ya lo calculaba así; ahora además expone QUIÉN reportó, CUÁNDO y con qué
-- KM, para pintar "Ya reportado por {nombre} · {fecha}" a cualquier usuario que
-- vea ese vehículo.
--
-- Z12 — El semanal se liga al PERFIL DEL AUTOR genéricamente vía checklists_vehiculo.creado_por
-- (ya existe). Recuperamos el "semanal huérfano": un reporte enviado por un usuario
-- que NO es el chofer asignado del vehículo (conductor_id null / no asignado) antes
-- quedaba invisible para su propio autor por el scoping T7. Se añade una tercera
-- condición al scoping: el AUTOR ve su propio reporte aunque no sea el chofer del
-- vehículo. Los roles elevados siguen viendo todo (T7 intacto para faltantes).
-- Aditivo/retrocompatible: mismas columnas + reportado_por/reportado_at/km_reporte.
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
  (ck.id is not null)                                 as tiene_reporte,
  -- Z13a — quién / cuándo / km del reporte vigente de la semana
  au.nombre                                           as reportado_por,
  ck.reportado_por_id,
  ck.reportado_at,
  ck.km_reporte
from semanas s
cross join veh v
left join asignado a  on a.vehiculo_id = v.id
left join sgc.usuarios ru on ru.id = v.responsable_id
left join lateral (
  select c.id, c.fecha, c.resultado,
         c.creado_por                          as reportado_por_id,
         coalesce(c.capturado_en, c.created_at) as reportado_at,
         c.kilometraje                          as km_reporte
    from sgc.checklists_vehiculo c
    join sgc.checklist_plantillas p on p.id = c.plantilla_id
   where c.vehiculo_id = v.id
     and p.frecuencia = 'semanal'
     and c.fecha >= s.semana_inicio
     and c.fecha <  s.semana_inicio + 7
   order by c.fecha desc, c.created_at desc
   limit 1
) ck on true
left join sgc.usuarios au on au.id = ck.reportado_por_id
-- Scoping: elevados ven todo; el chofer ve SUS vehículos; y el AUTOR ve su
-- propio reporte aunque no sea el chofer asignado (Z12 — recupera el huérfano).
where sgc.es_flota_elevado()
   or coalesce(a.usuario_id, v.responsable_id) = auth.uid()
   or ck.reportado_por_id = auth.uid();

grant select on sgc.v_reporte_semanal_cumplimiento to authenticated, service_role;
