-- ═══════════════════════════════════════════════════════════
-- Merge `obras` into `proyectos`: they modeled the same
-- real-world thing (a construction site) in two separate
-- catalogs. `proyectos` survives (fases, team, budget already
-- live there); `obras` is migrated in and dropped.
-- ═══════════════════════════════════════════════════════════

-- 1. proyectos gains obras' one field it didn't have
alter table sgc.proyectos add column if not exists localidad text;

-- 2. Migrate the existing obras rows into proyectos, keeping their id
--    (so any external reference to the old obra id still resolves)
--    and mapping obras.estado -> proyectos.estado vocabulary.
insert into sgc.proyectos (id, codigo, nombre, cliente, localidad, estado, activo, created_at)
select
  o.id,
  o.codigo,
  o.nombre,
  o.cliente,
  o.localidad,
  case o.estado
    when 'en_cotizacion' then 'planificacion'
    when 'en_ejecucion' then 'en_progreso'
    when 'finalizada' then 'completado'
    when 'no_adjudicada' then 'cancelado'
    else 'planificacion'
  end,
  o.activo,
  o.created_at
from sgc.obras o
where not exists (select 1 from sgc.proyectos p where p.id = o.id);

-- 3. Repoint Inventario's salidas from obra_id to proyecto_id
alter table sgc.salidas_inventario add column if not exists proyecto_id uuid references sgc.proyectos(id);
update sgc.salidas_inventario set proyecto_id = obra_id where obra_id is not null and proyecto_id is null;
alter table sgc.salidas_inventario drop column obra_id;

-- 4. obras is now fully superseded
drop table sgc.obras;
