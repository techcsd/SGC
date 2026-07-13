-- Sistema de estrellas: un proyecto no debe iniciar hasta cumplir sus parámetros.
-- 4 estrellas: cuadre inicial, expediente de inicio, equipo de obra, almacén de obra.
set search_path = sgc, public;

create or replace view sgc.v_proyecto_readiness with (security_invoker = true) as
select
  p.id as proyecto_id,
  (exists (select 1 from sgc.cuadre_obra c where c.proyecto_id = p.id)
   and exists (select 1 from sgc.cuadre_items ci where ci.proyecto_id = p.id)) as cuadre_ok,
  coalesce((
    select count(*) > 0 and count(*) filter (where e.estado in ('pendiente','cargado')) = 0
    from sgc.expediente_obra e where e.proyecto_id = p.id
  ), false) as expediente_ok,
  (exists (select 1 from sgc.proyecto_empleados pe where pe.proyecto_id = p.id and pe.rol = 'ing_responsable')
   and exists (select 1 from sgc.proyecto_empleados pe where pe.proyecto_id = p.id and pe.rol = 'ing_residente')) as equipo_ok,
  exists (select 1 from sgc.bodegas b where b.proyecto_id = p.id) as almacen_ok
from sgc.proyectos p;

grant select on sgc.v_proyecto_readiness to authenticated;
