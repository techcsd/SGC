-- ============================================================================
-- PROMPT-9 · FASE 5 — AA11: exponer el encargado/ingeniero del proyecto en el
-- contrato que consume la bitácora (default del paso 9/10 "ingeniero responsable").
-- Fecha: 2026-07-29. Aditivo (agrega claves al jsonb; retrocompatible).
--
-- Fuente del encargado: `proyectos.responsable_id` (encargado principal). Si no
-- lo tiene, cae al `proyecto_responsables` activo (primero 'responsable', luego
-- 'residente'). Devuelve `encargado_id` + `encargado_nombre` por proyecto.
-- ============================================================================

create or replace function sgc.mis_proyectos(p_usuario uuid default null::uuid)
returns jsonb language sql stable security definer set search_path to 'sgc', 'pg_temp'
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
      -- AA11 — encargado del proyecto (para default del ingeniero en bitácora).
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
