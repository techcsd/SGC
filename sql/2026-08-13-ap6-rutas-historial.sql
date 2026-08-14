-- =============================================================================
-- PROMPT-11 FASE 5 (AP6) — Submódulo "Rutas activas": tab de HISTÓRICO de rutas.
-- SGC padre. La vista de rutas ACTIVAS reutiliza sgc.rutas_activas_y_hoy() +
-- choferes_estado + ruta_breadcrumb_vivo (cero pipeline paralelo). Este contrato
-- aditivo cubre el tab de HISTÓRICO ("todas las rutas creadas") con filtros:
--   chofer, rango de fechas, obra (destino) y estado.
--
-- Gating: roles elevados (sgc.es_flota_elevado) ven TODAS; el resto sólo las suyas
-- (creadas por sí mismo o donde es el conductor) — misma verdad que rutas_activas_y_hoy.
-- =============================================================================

begin;

create or replace function sgc.rutas_historial(
  p_conductor uuid    default null,
  p_desde     date    default null,
  p_hasta     date    default null,
  p_obra      uuid    default null,
  p_estado    text    default null,
  p_limite    integer default 200
)
returns table (
  id                 uuid,
  estado             text,
  tipo               text,
  origen             text,
  destino            text,
  destino_proyecto_id uuid,
  obra               text,
  placa              text,
  conductor_id       uuid,
  conductor_nombre   text,
  fecha              date,
  iniciada_at        timestamptz,
  finalizada_at      timestamptz,
  km_real            numeric,
  km_estimado        numeric,
  duracion_min       integer,
  paradas_total      integer,
  paradas_entregadas integer
)
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    r.id, r.estado, r.tipo, r.origen, r.destino,
    r.destino_proyecto_id,
    pr.nombre as obra,
    v.placa,
    r.conductor_id, c.nombre as conductor_nombre,
    r.fecha, r.iniciada_at, r.finalizada_at,
    r.km_real, r.km_estimado,
    coalesce(
      r.tiempo_real_min,
      case when r.iniciada_at is not null and r.finalizada_at is not null
           then (extract(epoch from (r.finalizada_at - r.iniciada_at)) / 60)::int end
    ) as duracion_min,
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id) as paradas_total,
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id and p.estado = 'entregada') as paradas_entregadas
  from sgc.rutas r
  left join sgc.vehiculos   v  on v.id  = r.vehiculo_id
  left join sgc.conductores c  on c.id  = r.conductor_id
  left join sgc.proyectos   pr on pr.id = r.destino_proyecto_id
  where (sgc.es_flota_elevado()
         or r.creado_por = auth.uid()
         or r.conductor_id in (select sgc.mis_conductor_ids()))
    and ((not coalesce(r.es_prueba, false)) or sgc.is_admin())
    and (p_conductor is null or r.conductor_id = p_conductor)
    and (p_desde is null or r.fecha >= p_desde)
    and (p_hasta is null or r.fecha <= p_hasta)
    and (p_obra   is null or r.destino_proyecto_id = p_obra)
    and (p_estado is null or r.estado = p_estado)
  order by r.fecha desc, r.iniciada_at desc nulls last, r.created_at desc
  limit greatest(1, least(p_limite, 500));
$function$;

grant execute on function sgc.rutas_historial(uuid, date, date, uuid, text, integer)
  to authenticated, service_role;

comment on function sgc.rutas_historial(uuid, date, date, uuid, text, integer) is
  'AP6 — histórico de rutas (todas las creadas) para el submódulo Rutas activas. Elevados ven todas; el resto las suyas. Filtros: chofer, fechas, obra destino, estado. Complementa rutas_activas_y_hoy (tab de activas).';

commit;
