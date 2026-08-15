-- =============================================================================
-- AR1b — Corrección: el personal de obra debe ser OBRA-SCOPED para roles granulares
--
-- La versión AR1 de puede_ver/gestionar_personal_obra incluía un chequeo global
-- `puede_ver_submodulo('proyectos.personal')`, que convertía el grant del submódulo
-- en "ver/operar TODO el personal de todas las obras". Eso contradice la matriz
-- confirmada: admin/RRHH/Gerencia ven y editan TODO; ingenieros/capataces ven y
-- registran SÓLO el personal de SU obra.
--
-- Fix: se quita el chequeo global del submódulo. Los elevados quedan cubiertos por
-- su MÓDULO (proyectos/rrhh/direccion); los granulares por su vínculo con la obra
-- (responsable_id / proyecto_responsables / proyecto_empleados). El acceso a la
-- PÁGINA sigue gobernado por el submódulo (guard de ruta, client-side), pero los
-- DATOS quedan acotados a su obra por la RLS. Aditivo (create or replace).
-- =============================================================================

begin;

create or replace function sgc.puede_ver_personal_obra(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh') or sgc.tiene_modulo('direccion')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables pr where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo)
      or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
                  where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid());
$$;

create or replace function sgc.puede_gestionar_personal_obra(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path to 'sgc','pg_temp' as $$
  select sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh') or sgc.tiene_modulo('direccion')
      or exists (select 1 from sgc.proyectos p where p.id = p_proyecto_id and p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables pr where pr.proyecto_id = p_proyecto_id and pr.usuario_id = auth.uid() and pr.activo)
      or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
                  where pe.proyecto_id = p_proyecto_id and e.usuario_id = auth.uid());
$$;

commit;
