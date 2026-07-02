-- Mi Proyecto (bitácora module) needs to read sgc.empleados/proyecto_empleados to
-- resolve which proyecto an ingeniero_campo is assigned to. Both currently allow
-- ANY authenticated user to read everything, including salario — tightening these
-- two specifically since they're the ones this lower-trust role now touches.
-- (The rest of the schema's permissive RLS remains a separate, larger follow-up.)

drop policy "empleados: all" on sgc.empleados;
create policy "empleados: select" on sgc.empleados for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "empleados: insert" on sgc.empleados for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "empleados: update" on sgc.empleados for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'));
create policy "empleados: delete" on sgc.empleados for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('rrhh'));

drop policy "proyecto_empleados: all" on sgc.proyecto_empleados;
create policy "proyecto_empleados: select" on sgc.proyecto_empleados for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('rrhh')
    or exists (select 1 from sgc.empleados e where e.id = empleado_id and e.usuario_id = auth.uid())
  );
create policy "proyecto_empleados: insert" on sgc.proyecto_empleados for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "proyecto_empleados: update" on sgc.proyecto_empleados for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "proyecto_empleados: delete" on sgc.proyecto_empleados for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
