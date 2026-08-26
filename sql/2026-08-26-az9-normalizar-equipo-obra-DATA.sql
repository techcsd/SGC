-- AZ9 — Normaliza el equipo de obra de texto libre → usuarios reales (con OK de Xaviel).
-- Fija ingeniero_obra_id (principal del texto) por obra.
do $$
declare
  abraham uuid; ivan uuid; ocsena uuid; bernabel uuid; roberly uuid; guilamo uuid; roman uuid;
  pairs record;
begin
  select id into abraham from sgc.usuarios where nombre='Abraham Mercedes';
  select id into ivan from sgc.usuarios where nombre='Ivan Lapaix';
  select id into ocsena from sgc.usuarios where nombre='Jose Ocsena';
  select id into bernabel from sgc.usuarios where nombre='Bernabel Ortiz';
  select id into roberly from sgc.usuarios where nombre='Roberly Camacho';
  select id into guilamo from sgc.usuarios where nombre='Manuel Guilamo';
  select id into roman from sgc.usuarios where nombre='Jonathan Roman';

  update sgc.proyectos set ingeniero_obra_id=abraham where nombre ilike 'BEST IN PRO%' and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=ivan     where nombre ilike 'BATCON%'      and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=ocsena   where nombre ilike 'NOVAL - Poseidonia%' and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=bernabel where nombre ilike 'BLUEWAVE - Olea%'    and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=bernabel where nombre ilike 'BLUEWAVE - Volares%'  and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=ocsena   where nombre ilike 'NOVAL - Riviera Bay%' and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=bernabel where nombre ilike 'ASA - Residencial Romo%' and ingeniero_obra_id is null;
  update sgc.proyectos set ingeniero_obra_id=guilamo  where nombre ilike 'ROSCH%'        and ingeniero_obra_id is null;

  -- Todos los ingenieros mencionados quedan como responsables reales (alimenta AY4), sin duplicar.
  for pairs in
    select p.id as pid, x.uid from sgc.proyectos p
    join lateral (values
      ('BEST IN PRO%', abraham),
      ('BATCON%', ivan),
      ('NOVAL - Poseidonia%', ocsena),
      ('BLUEWAVE - Olea%', bernabel),
      ('BLUEWAVE - Volares%', bernabel),
      ('NOVAL - Riviera Bay%', ocsena),
      ('NOVAL - Riviera Bay%', roberly),
      ('ASA - Residencial Romo%', bernabel),
      ('ROSCH%', guilamo),
      ('ROSCH%', roman)
    ) as x(pat, uid) on p.nombre ilike x.pat
    where x.uid is not null
  loop
    if not exists (select 1 from sgc.proyecto_responsables r where r.proyecto_id=pairs.pid and r.usuario_id=pairs.uid and r.activo) then
      insert into sgc.proyecto_responsables(proyecto_id, usuario_id, tipo_responsabilidad, activo)
      values (pairs.pid, pairs.uid, 'responsable', true);
    end if;
  end loop;
end $$;
select nombre, ingeniero_obra_id is not null as tiene_ing from sgc.proyectos
 where coalesce(es_prueba,false)=false and coalesce(ingeniero_obra,'')<>'' order by nombre;
