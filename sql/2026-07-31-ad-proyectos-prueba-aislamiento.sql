-- ============================================================================
-- Aislamiento de proyectos de PRUEBA en dashboards y listas — 31/07/2026
-- ----------------------------------------------------------------------------
-- La RLS de `proyectos` (policy RESTRICTIVE "es_prueba: oculta a no-admin") ya
-- oculta los proyectos de prueba a los no-admin en accesos DIRECTOS. Pero dos
-- RPCs SECURITY DEFINER los devolvían igual (bypass de RLS):
--   - kpi_proyectos()  → los contaba en el dashboard de TODOS.
--   - mis_proyectos()  → los listaba a cualquier usuario.
--
-- Fix: los KPIs NUNCA cuentan datos de prueba (aggregados = datos reales).
-- mis_proyectos oculta los de prueba a no-admin (admin los ve y su toggle en la
-- página Proyectos decide si se muestran).
-- ============================================================================

create or replace function sgc.kpi_proyectos()
 returns table(proyecto_id uuid, codigo text, nombre text, responsable_id uuid, responsable_nombre text, avance_promedio numeric, bitacoras_30d integer, incidentes_90d integer, presupuesto numeric, gasto_real numeric)
 language plpgsql
 stable security definer
 set search_path to 'sgc'
as $function$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    return;
  end if;

  return query
  select
    p.id,
    p.codigo::text,
    p.nombre::text,
    p.responsable_id,
    u.nombre::text as responsable_nombre,
    coalesce((select avg(f.progreso) from sgc.fases_proyecto f where f.proyecto_id = p.id), 0)::numeric as avance_promedio,
    (select count(*) from sgc.bitacoras b
       where b.proyecto_id = p.id and b.tipo = 'parte_diario'
         and b.fecha >= (current_date - interval '30 days'))::int as bitacoras_30d,
    (select count(*) from sgc.bitacoras b
       where b.proyecto_id = p.id and b.tipo = 'incidente'
         and b.fecha >= (current_date - interval '90 days'))::int as incidentes_90d,
    p.presupuesto,
    coalesce((select sum(oc.total) from sgc.ordenes_compra oc
       where oc.proyecto_id = p.id and oc.estado in ('aprobada', 'recibida')), 0)::numeric as gasto_real
  from sgc.proyectos p
  left join sgc.usuarios u on u.id = p.responsable_id
  where p.activo = true and p.estado in ('planificacion', 'en_progreso', 'pausado')
    and not coalesce(p.es_prueba, false);  -- los KPIs nunca cuentan datos de prueba
end;
$function$;

create or replace function sgc.mis_proyectos(p_usuario uuid default null::uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  with target as (
    select case when sgc.is_admin() then coalesce(p_usuario, auth.uid()) else auth.uid() end as uid
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo), '[]'::jsonb)
  from (
    select p.*,
      coalesce(
        (select jsonb_agg(to_jsonb(f) order by f.orden nulls last, f.created_at)
         from sgc.fases_proyecto f where f.proyecto_id = p.id),
        '[]'::jsonb
      ) as fases,
      enc.encargado_id,
      enc.encargado_nombre
    from sgc.proyectos p, target
    left join lateral (
      select u.id as encargado_id, u.nombre as encargado_nombre
      from sgc.usuarios u
      where u.id = coalesce(
        p.responsable_id,
        (select pr.usuario_id from sgc.proyecto_responsables pr
          where pr.proyecto_id = p.id and coalesce(pr.activo, true)
          order by case pr.tipo_responsabilidad when 'responsable' then 0 when 'residente' then 1 else 2 end,
                   pr.desde nulls last
          limit 1)
      )
      limit 1
    ) enc on true
    where p.activo = true
      and (not coalesce(p.es_prueba, false) or sgc.is_admin())  -- prueba: solo admin
      and (
        p.responsable_id = target.uid
        or exists (
          select 1 from sgc.proyecto_empleados pe
          join sgc.empleados e on e.id = pe.empleado_id
          where pe.proyecto_id = p.id and e.usuario_id = target.uid
        )
      )
  ) t;
$function$;
