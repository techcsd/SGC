-- DH11 — los permisos rrhh.empleados / rrhh.asistencia / rrhh.ausencias decían
-- "Próximamente" en Roles, pero eran mentira: el código los lista en
-- `SUBMODULOS.rrhh` (roles.service.ts) sin que nada los gatee de verdad — RLS
-- de empleados/asistencia/solicitudes_ausencia usaba `tiene_modulo('rrhh')` a
-- secas, sin distinguir submódulo.
--
-- `sgc.nivel_submodulo()` YA tiene el atajo "módulo padre = operar" (compat),
-- así que cambiar el predicado a `puede_ver_submodulo`/`puede_operar_submodulo`
-- NO le quita acceso a nadie hoy: los 4 roles con el módulo `rrhh` completo
-- (gerencia, dirección, admin, jefe_rrhh) lo siguen teniendo automáticamente vía
-- ese atajo. Lo que gana Xaviel es poder, DESDE Roles, restringir un rol nuevo
-- a SOLO uno de los 3 submódulos sin darle el módulo completo.

begin;

-- ── empleados ────────────────────────────────────────────────────────────
alter policy "empleados: select" on sgc.empleados
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.puede_ver_submodulo('rrhh.empleados'));
alter policy "empleados: insert" on sgc.empleados
  with check (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.empleados'));
alter policy "empleados: update" on sgc.empleados
  using (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.empleados'));
alter policy "empleados: delete" on sgc.empleados
  using (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.empleados'));

-- ── asistencia ───────────────────────────────────────────────────────────
alter policy "asistencia: select" on sgc.asistencia
  using (sgc.is_admin() or sgc.puede_ver_submodulo('rrhh.asistencia'));
alter policy "asistencia: insert" on sgc.asistencia
  with check (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.asistencia'));
alter policy "asistencia: update" on sgc.asistencia
  using (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.asistencia'))
  with check (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.asistencia'));
alter policy "asistencia: delete" on sgc.asistencia
  using (sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.asistencia'));

-- ── solicitudes_ausencia (conserva el auto-servicio del empleado) ─────────
alter policy "solicitudes_ausencia: select" on sgc.solicitudes_ausencia
  using (
    sgc.is_admin() or sgc.puede_ver_submodulo('rrhh.ausencias')
    or solicitado_por = auth.uid()
    or exists (select 1 from sgc.empleados e where e.id = solicitudes_ausencia.empleado_id and e.usuario_id = auth.uid())
  );
alter policy "solicitudes_ausencia: insert" on sgc.solicitudes_ausencia
  with check (
    solicitado_por = auth.uid()
    and (
      sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.ausencias')
      or exists (select 1 from sgc.empleados e where e.id = solicitudes_ausencia.empleado_id and e.usuario_id = auth.uid())
    )
  );
alter policy "solicitudes_ausencia: update" on sgc.solicitudes_ausencia
  using ((sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.ausencias')) and estado = 'pendiente')
  with check (aprobado_por = auth.uid() and estado = any (array['aprobada','rechazada']));
alter policy "solicitudes_ausencia: delete" on sgc.solicitudes_ausencia
  using (
    sgc.is_admin() or sgc.puede_operar_submodulo('rrhh.ausencias')
    or (solicitado_por = auth.uid() and estado = 'pendiente')
  );

commit;
