-- 2026-10-10-ck15b-listado-orden.sql   (CK15 "Ordenar el día" — PROMPT-96 F1 · app 2.47.0)
-- CANÓNICA (dev + prod). `sgc.trabajo_ordenar` ya escribe orden/orden_transporte/
-- trabajos_manual.orden, y el cuerpo vivo de `trabajos_transporte_listado` ya ORDENA por
-- `t.orden`, PERO no DEVUELVE la columna → la app puede FIJAR el orden pero no REFLEJARLO
-- (no cablea el botón "ordenar"). Este archivo recrea la función con su cuerpo vivo de PROD
-- (verificado por objeto) + añade `orden int` al final del RETURNS TABLE y al SELECT.
--
-- Cambia la firma de retorno → DROP + CREATE. Sin dependientes (pg_depend).
--
-- ⚠️ DIVERGENCIA dev/prod CONOCIDA (regla 19): en DEV esta función lleva además las
-- cláusulas `es_usuario_demo()` de `2026-10-09-ck-demo-visibilidad.sql` (SOLO-DEV, para el
-- revisor de tiendas). `es_usuario_demo()` NO existe en prod. Por eso esta canónica NO lleva
-- la cláusula demo; el overlay demo de dev se RE-APLICA aparte con
-- `2026-10-11-ck15b-dev-demo-overlay.sql` (SOLO dev) para re-añadir la cláusula + orden.
--
--   node scripts/apply-migration.mjs sql/2026-10-10-ck15b-listado-orden.sql --env dev

begin;

drop function if exists sgc.trabajos_transporte_listado(date, text, uuid);
create function sgc.trabajos_transporte_listado(
  p_dia date default null, p_estado text default null, p_conductor_id uuid default null)
returns table(
  origen text, origen_id uuid, tipo text, descripcion text, proyecto_id uuid, proyecto text,
  dia date, estado text, conductor_id uuid, conductor text, vehiculo_id uuid, ruta_id uuid,
  created_at timestamp with time zone, orden int)
language sql stable security definer
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
         p.nombre, t.dia, t.estado, t.conductor_id, c.nombre, t.vehiculo_id, t.ruta_id,
         t.created_at, t.orden
    from t
    left join sgc.proyectos p on p.id = t.proyecto_id
    left join sgc.conductores c on c.id = t.conductor_id
   where sgc.es_flota_elevado()
     and (p_dia is null or t.dia = p_dia)
     and (p_estado is null or t.estado = p_estado)
     and (p_conductor_id is null or t.conductor_id = p_conductor_id)
   order by t.orden, t.created_at desc;
$function$;
grant execute on function sgc.trabajos_transporte_listado(date, text, uuid) to authenticated, service_role;

commit;
