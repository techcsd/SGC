-- 2026-10-10-ck17-listado-orden.sql   ⚠️ LO APLICA EL PADRE (SGC) — regla 18/19
-- CK17 (cierra la nota diferida de CK15·A) — `trabajos_transporte_listado` ahora ordena
-- por el `orden` que fija Misael (sgc.trabajo_ordenar), y luego por fecha. Antes ordenaba
-- solo por created_at desc, así que `trabajo_ordenar` no tenía efecto visible.
--
-- Versión CANÓNICA (= cuerpo vivo de PROD + una columna `orden` en el CTE + order by).
-- NO cambia el RETURNS TABLE (CREATE OR REPLACE limpio, sin drop). La variante de DEV con
-- los guards `es_usuario_demo` se re-aplica aparte en ck17b (SOLO DEV), como el overlay
-- ck-demo-visibilidad. Regla 19: comparado contra el cuerpo vivo de prod, sin más cambios.
--
--   node scripts/apply-migration.mjs sql/2026-10-10-ck17-listado-orden.sql --env dev
--   node scripts/apply-migration.mjs sql/2026-10-10-ck17-listado-orden.sql --env prod

begin;

create or replace function sgc.trabajos_transporte_listado(p_dia date default null, p_estado text default null, p_conductor_id uuid default null)
 returns table(origen text, origen_id uuid, tipo text, descripcion text, proyecto_id uuid, proyecto text, dia date, estado text, conductor_id uuid, conductor text, vehiculo_id uuid, ruta_id uuid, created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  with t as (
    select 'apoyo'::text origen, s.id origen_id, s.tipo_apoyo tipo,
           coalesce(s.descripcion, s.que_se_mueve) descripcion, s.proyecto_id,
           s.dia, s.estado, s.conductor_id, null::uuid vehiculo_id, s.ruta_id, s.created_at,
           coalesce(s.orden, 0) orden
      from sgc.solicitudes_movimiento s
     where coalesce(s.es_prueba,false) = false
    union all
    select 'requisicion'::text, si.id, 'conduce'::text,
           'Conduce por asignar', si.proyecto_id,
           si.fecha, 'pendiente'::text, si.conductor_id, si.vehiculo_id, si.ruta_id, si.created_at,
           coalesce(si.orden_transporte, 0)
      from sgc.salidas_inventario si
     where si.estado = 'despachado' and si.conductor_id is null and si.anulado_por is null
       and coalesce(si.es_prueba,false) = false
    union all
    select 'manual'::text, m.id, 'actividad'::text, m.descripcion, m.proyecto_id,
           m.dia, m.estado, m.conductor_id, m.vehiculo_id, m.ruta_id, m.created_at,
           coalesce(m.orden, 0)
      from sgc.trabajos_manual m
  )
  select t.origen, t.origen_id, t.tipo, t.descripcion, t.proyecto_id,
         p.nombre, t.dia, t.estado, t.conductor_id, c.nombre, t.vehiculo_id, t.ruta_id, t.created_at
    from t
    left join sgc.proyectos p on p.id = t.proyecto_id
    left join sgc.conductores c on c.id = t.conductor_id
   where sgc.es_flota_elevado()
     and (p_dia is null or t.dia = p_dia)
     and (p_estado is null or t.estado = p_estado)
     and (p_conductor_id is null or t.conductor_id = p_conductor_id)
   order by t.orden, t.created_at desc;
$function$;

commit;
