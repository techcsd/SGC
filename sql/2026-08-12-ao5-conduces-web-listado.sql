-- AO5 — Submódulo Conduces (web): listado completo con clasificación por FASE.
--
-- El estado simple (despachado/entregado) no basta para las 4 pestañas. Se clasifica
-- server-side reutilizando sgc.conduce_fase() (única fuente de verdad) en 3 buckets:
--   • pendientes_entrega  → aún en manos del chofer  (emitido/en_transito/entregando)
--   • por_confirmar        → entregado, falta firma/confirmación del receptor
--   • historico            → confirmado (cerrado)
-- La pestaña "Activos" del cliente = todo lo que NO es histórico (pendientes+por_confirmar).
--
-- Visibilidad: admin, o quien tenga módulo flota/inventario o el submódulo
-- inventario.salidas (misma puerta que la ruta web). SECURITY DEFINER + gate explícito.

set search_path = sgc, public;

create or replace function sgc.conduces_web_listado()
returns table (
  id           uuid,
  fecha        date,
  estado       text,
  fase         text,
  bucket       text,
  proyecto_id  uuid,
  proyecto     text,
  bodega       text,
  conductor    text,
  responsable  text,
  items        int,
  es_prueba    boolean,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    s.id,
    s.fecha,
    s.estado::text,
    f.fase,
    case f.fase
      when 'confirmado'       then 'historico'
      when 'entregado'        then 'por_confirmar'
      when 'pendiente_firma'  then 'por_confirmar'
      else 'pendientes_entrega'      -- emitido / en_transito / entregando
    end as bucket,
    s.proyecto_id,
    pr.nombre as proyecto,
    bo.nombre as bodega,
    co.nombre as conductor,
    s.responsable,
    (select count(*)::int from sgc.detalle_salidas d where d.salida_id = s.id) as items,
    s.es_prueba,
    s.created_at
  from sgc.salidas_inventario s
  cross join lateral (select sgc.conduce_fase(s.id) as fase) f
  left join sgc.proyectos   pr on pr.id = s.proyecto_id
  left join sgc.bodegas     bo on bo.id = s.bodega_id
  left join sgc.conductores co on co.id = s.conductor_id
  where sgc.is_admin()
     or sgc.tiene_modulo('flota')
     or sgc.tiene_modulo('inventario')
     or sgc.puede_ver_submodulo('inventario.salidas')
  order by s.created_at desc;
$function$;

grant execute on function sgc.conduces_web_listado() to authenticated, service_role;

comment on function sgc.conduces_web_listado() is
  'AO5: listado web de conduces con fase + bucket (pendientes_entrega|por_confirmar|historico) para las pestañas.';
