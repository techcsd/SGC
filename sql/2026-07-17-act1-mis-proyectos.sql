-- ============================================================================
-- Actualización 1 — P2: "Mi proyecto" (responsable + equipo, con/sin ficha)
-- ----------------------------------------------------------------------------
-- getAsignadosA() solo miraba proyecto_empleados vía empleados.usuario_id, así
-- que ignoraba (a) proyectos donde el usuario es responsable_id y (b) usuarios
-- sin ficha de empleado. RPC SECURITY DEFINER que une ambas condiciones, con las
-- fases embebidas (la vista las usa). Aditivo/idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.mis_proyectos(p_usuario uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  with target as (
    -- Un no-admin solo puede consultarse a sí mismo; admin puede consultar a cualquiera.
    select case when sgc.is_admin() then coalesce(p_usuario, auth.uid()) else auth.uid() end as uid
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.codigo), '[]'::jsonb)
  from (
    select p.*,
      coalesce(
        (select jsonb_agg(to_jsonb(f) order by f.orden nulls last, f.created_at)
         from sgc.fases_proyecto f where f.proyecto_id = p.id),
        '[]'::jsonb
      ) as fases
    from sgc.proyectos p, target
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

grant execute on function sgc.mis_proyectos(uuid) to authenticated;

-- P2 (fix RLS de detalle): el responsable de un proyecto debe poder abrirlo
-- aunque no esté en proyecto_empleados ni tenga el módulo proyectos. Aditivo:
-- solo AGREGA `responsable_id = auth.uid()` a la condición de SELECT existente.
drop policy if exists "proyectos: select" on sgc.proyectos;
create policy "proyectos: select" on sgc.proyectos for select
  using (
    sgc.is_admin()
    or sgc.tiene_modulo('proyectos')
    or responsable_id = auth.uid()
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = proyectos.id and e.usuario_id = auth.uid()
    )
  );
