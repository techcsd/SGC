-- 2026-10-10-ck17b-listado-orden-demo.sql   ⚠️ SOLO DEV — NO VA A PROD (overlay de demo)
-- CK17b — re-aplica, SOLO EN DEV, la variante de `trabajos_transporte_listado` con los
-- guards `es_usuario_demo()` (que añadió ck-demo-visibilidad, dev-only) PERO con el nuevo
-- orden por `orden`. Se corre DESPUÉS de ck17 en dev (ck17 deja la canónica sin guards;
-- esto la vuelve a envolver con el filtro demo). En prod NO existe `es_usuario_demo`, así
-- que esta migración NO se promueve (igual que ck-demo-visibilidad).
--
--   node scripts/apply-migration.mjs sql/2026-10-10-ck17b-listado-orden-demo.sql --env dev

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
     where (case when sgc.es_usuario_demo() then coalesce(s.es_prueba,false) else coalesce(s.es_prueba,false) = false end)
    union all
    select 'requisicion'::text, si.id, 'conduce'::text,
           'Conduce por asignar', si.proyecto_id,
           si.fecha, 'pendiente'::text, si.conductor_id, si.vehiculo_id, si.ruta_id, si.created_at,
           coalesce(si.orden_transporte, 0)
      from sgc.salidas_inventario si
     where si.estado = 'despachado' and si.conductor_id is null and si.anulado_por is null
       and (case when sgc.es_usuario_demo() then coalesce(si.es_prueba,false) else coalesce(si.es_prueba,false) = false end)
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
     and (not sgc.es_usuario_demo()
          or exists (select 1 from sgc.proyectos pd where pd.id = t.proyecto_id and coalesce(pd.es_prueba,false)))
     and (p_dia is null or t.dia = p_dia)
     and (p_estado is null or t.estado = p_estado)
     and (p_conductor_id is null or t.conductor_id = p_conductor_id)
   order by t.orden, t.created_at desc;
$function$;

commit;
