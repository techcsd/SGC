-- ═══════════════════════════════════════════════════════════
-- RLS lockdown, table 1 of N: sgc.proyectos + sgc.fases_proyecto.
--
-- Both still had `for all to authenticated using (true) with check (true)`
-- — the app-wide permissive pattern (see feedback_rls-is-permissive memory)
-- — meaning any authenticated session, including a field engineer's, could
-- read/write EVERY project's data (including `presupuesto`, company-wide
-- budgets) directly via PostgREST, and could create/edit/delete any
-- project or phase, regardless of what the UI shows them.
--
-- This also closes a real functional bug, not just a security one: every
-- engineer-facing page (bitacora/nueva, solicitudes-material,
-- solicitudes-compra, bitacora/historial) calls
-- `ProyectosService.getAll()` for its project picker — an unscoped SELECT.
-- Once this policy is live, that same call returns ALL projects for
-- admin/proyectos-module users (correct, unchanged) but only the
-- engineer's own assigned project(s) for everyone else — no frontend
-- change needed, the existing getAll() call becomes correctly scoped for
-- free because RLS filters rows before they ever reach the client.
--
-- Pattern reused verbatim from documentos_proyecto/documentos_generados
-- (built earlier this session): admin, or the module that owns this data
-- (`proyectos`), or a proyecto_empleados-linked team member, can read;
-- only admin/proyectos-module can write.
-- ═══════════════════════════════════════════════════════════

drop policy "proyectos: all" on sgc.proyectos;

create policy "proyectos: select" on sgc.proyectos for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('proyectos')
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = proyectos.id and e.usuario_id = auth.uid()
    )
  );
create policy "proyectos: insert" on sgc.proyectos for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "proyectos: update" on sgc.proyectos for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "proyectos: delete" on sgc.proyectos for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'));

grant select, insert, update, delete on sgc.proyectos to authenticated;

-- fases_proyecto is embedded in every proyectos query (`fases:fases_proyecto(*)`)
-- and is also directly queryable on its own — scoping the parent alone
-- would leave every project's phases readable/writable by anyone via a
-- direct query to this table. Read visibility mirrors proyectos; writes
-- stay admin/proyectos-module only (confirmed: createFase/updateFase/
-- deleteFase/updateProgreso are only ever called from proyectos/lista.ts,
-- the admin/proyectos-module page — Mi Proyecto only ever displays phases
-- read-only, no edit controls exist there).
drop policy "fases: all" on sgc.fases_proyecto;

create policy "fases_proyecto: select" on sgc.fases_proyecto for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('proyectos')
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = fases_proyecto.proyecto_id and e.usuario_id = auth.uid()
    )
  );
create policy "fases_proyecto: insert" on sgc.fases_proyecto for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "fases_proyecto: update" on sgc.fases_proyecto for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  with check (sgc.is_admin() or sgc.tiene_modulo('proyectos'));
create policy "fases_proyecto: delete" on sgc.fases_proyecto for delete to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('proyectos'));

grant select, insert, update, delete on sgc.fases_proyecto to authenticated;

-- ═══════════════════════════════════════════════════════════
-- KNOWN RESIDUAL GAP (flagging, not fixing here — needs a product
-- decision, not just SQL): RLS is row-level, not column-level. An
-- engineer assigned to a project can now only ever SELECT their OWN
-- project's row — but that row still includes `presupuesto`, since
-- `select('*')` doesn't distinguish columns. The original Bitácora design
-- explicitly said "Mi Proyecto: no presupuesto/financials" — today that's
-- only enforced by mi-proyecto.html simply not rendering the field, so a
-- technically-savvy engineer could still read their own project's budget
-- via a direct API call (they could NOT before this migration see any
-- OTHER project's budget, and cannot now either — that cross-project
-- leak, the big one, is closed). Fully closing this needs either a
-- restricted view/RPC that omits `presupuesto` for non-admin/proyectos
-- callers, or Postgres column-level GRANTs — a bigger, separate change.
-- ═══════════════════════════════════════════════════════════
