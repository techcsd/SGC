-- Per-project KPI feed for the Encargados leaderboard. One SECURITY DEFINER RPC
-- aggregates the raw metrics across proyectos, fases, bitácoras and órdenes de
-- compra; the weighted score is computed client-side so the weights stay
-- tunable without a migration. Access is gated to admin / proyectos-module
-- inside the function (it reads every project, bypassing per-row RLS).
create or replace function sgc.kpi_proyectos()
returns table (
  proyecto_id        uuid,
  codigo             text,
  nombre             text,
  responsable_id     uuid,
  responsable_nombre text,
  avance_promedio    numeric,
  bitacoras_30d      integer,
  incidentes_90d     integer,
  presupuesto        numeric,
  gasto_real         numeric
)
language plpgsql
security definer
stable
set search_path = sgc
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos')) then
    return;  -- no rows for unauthorized callers
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
  where p.activo = true and p.estado in ('planificacion', 'en_progreso', 'pausado');
end;
$$;

revoke all on function sgc.kpi_proyectos() from public;
grant execute on function sgc.kpi_proyectos() to authenticated;
