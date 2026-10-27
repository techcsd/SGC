-- ============================================================================
-- CZ4 (PROMPT-120, ronda CZ, 26/10/2026) — Rol "Subadministrador" (codigo
-- `subadmin`). Nota 3 de Xaviel: "lets create a role below administrator but
-- better than the other users... if in the future i need to give access to
-- another person to the system he must no be able to see these secrets and
-- the other sensitive submodules". Nombre confirmado por Xaviel: «Subadministrador».
--
-- DZ-20: módulos de partida inventario/compras/proyectos/flota/bitacora/
-- documentos/plantillas/tareas. NO admin/direccion/legal/rrhh/tecnologia —
-- verificado en F0 que `es_tecnologia()` (sql/2026-09-23-bx1b) es por LISTA DE
-- ROLES (admin|tecnologia|gerencia|direccion|desarrollador), no por módulo, así
-- que darle el módulo `tecnologia` abriría igual Odoo-sync/monitoreo/APIs/QA/
-- Issues/Dev notes vía `tecnologiaGuard` en el cliente (`UserService.esTecnologia`
-- SÍ incluye `hasModulo('tecnologia')` como OR — asimetría cliente/servidor
-- documentada en el hallazgo de F3 más abajo). La "Tecnología de contenido"
-- (inventario TI, compras tecnológicas, Cotizaciones, guía) se da por PERMISOS
-- GRANULARES (AG12) en vez del módulo completo — guía ya es pública (sin gate).
--
-- `es_subadmin()` NO entra en `is_admin()` (que sigue siendo codigo='admin'
-- estricto, sql/2026-07-03-review-fixes.sql, sin tocar).
--
-- Apply: node scripts/apply-migration.mjs sql/2026-10-26-cz3-rol-subadmin.sql --env dev  →  --env prod
-- ============================================================================
begin;
set local search_path = sgc, public;

-- ── (0) Sincronizar la secuencia de roles.id (gotcha recurrente roles_id_seq) ─
select setval('sgc.roles_id_seq', (select coalesce(max(id), 1) from sgc.roles), true);

-- ── (1) El rol ───────────────────────────────────────────────────────────────
insert into sgc.roles (codigo, nombre, modulos, permisos, es_operativo, descripcion)
select 'subadmin', 'Subadministrador',
  array['inventario', 'compras', 'proyectos', 'flota', 'bitacora', 'documentos', 'plantillas', 'tareas'],
  jsonb_build_object(
    'tecnologia.inventario', 'operar',
    'tecnologia.compras', 'operar',
    'tecnologia.cotizaciones', 'operar'
  ),
  false,
  'Rol por debajo de Administrador: gestiona la operación diaria (inventario, compras, proyectos, flota, bitácora, documentos, plantillas, tareas) y el contenido de Tecnología (inventario TI, compras tecnológicas, Cotizaciones) sin el módulo tecnologia completo. NO ve Vault, Administración, Legal, RRHH, Dirección ni la plataforma de Tecnología (Odoo-sync, monitoreo, APIs, QA, Issues).'
where not exists (select 1 from sgc.roles where codigo = 'subadmin');

-- Si ya existía (re-run), asegura módulos/permisos/flags al valor canónico —
-- sin pisar permisos granulares ajenos que Xaviel haya ajustado manualmente
-- después en Administración › Roles (se fusionan con ||, nunca se reemplazan).
update sgc.roles set
  nombre = 'Subadministrador',
  modulos = array['inventario', 'compras', 'proyectos', 'flota', 'bitacora', 'documentos', 'plantillas', 'tareas'],
  es_operativo = false,
  permisos = coalesce(permisos, '{}'::jsonb) || jsonb_build_object(
    'tecnologia.inventario', 'operar',
    'tecnologia.compras', 'operar',
    'tecnologia.cotizaciones', 'operar'
  )
where codigo = 'subadmin';

-- ── (2) Predicado único ────────────────────────────────────────────────────
create or replace function sgc.es_subadmin()
returns boolean
language sql stable security definer set search_path = sgc, public
as $$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo = 'subadmin'
  );
$$;
grant execute on function sgc.es_subadmin() to authenticated, service_role;

-- ── (3) Tecnología de contenido por permiso granular (DZ-20) ────────────────
-- (3a) tec_equipos / tec_equipo_historial / tec_equipo_tipos (inventario TI):
-- ya aceptaban is_admin()/tiene_modulo('tecnologia'); se AMPLÍA (OR, aditivo)
-- con el permiso granular 'tecnologia.inventario'.
drop policy if exists tec_equipos_all on sgc.tec_equipos;
create policy tec_equipos_all on sgc.tec_equipos for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_ver_submodulo('tecnologia.inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));

drop policy if exists tec_hist_all on sgc.tec_equipo_historial;
create policy tec_hist_all on sgc.tec_equipo_historial for all to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_ver_submodulo('tecnologia.inventario'))
  with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));

drop policy if exists tec_equipo_tipos_ins on sgc.tec_equipo_tipos;
create policy tec_equipo_tipos_ins on sgc.tec_equipo_tipos
  for insert to authenticated with check (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));
drop policy if exists tec_equipo_tipos_upd on sgc.tec_equipo_tipos;
create policy tec_equipo_tipos_upd on sgc.tec_equipo_tipos
  for update to authenticated using (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.inventario'));

-- (3b) Compras tecnológicas (solicitudes_compra categoria='tecnologia'): el
-- único gate por MÓDULO que quedaba era el de CREAR (crear_solicitud_compra_tec);
-- el resto de las RPC (enviar/decidir/marcar comprada/adjuntar/elegir cotización)
-- ya gatean por dueño/aprobador/admin, sin módulo — no hace falta tocarlas.
-- Misma firma (CQ1), solo se amplía la condición (aditivo).
create or replace function sgc.crear_solicitud_compra_tec(
  p_notas text,
  p_items jsonb,
  p_titulo text default null,
  p_urgencia text default 'normal',
  p_proyecto_id uuid default null,
  p_itbis_incluido boolean default false
)
returns uuid
language plpgsql security definer set search_path = sgc, public
as $$
declare
  v_id uuid;
  v_suma numeric;
  v_subtotal numeric;
  v_itbis numeric;
  v_total numeric;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('tecnologia') or sgc.puede_operar_submodulo('tecnologia.compras')) then
    raise exception 'No autorizado para crear compras tecnológicas.';
  end if;

  select coalesce(sum((i->>'cantidad')::numeric * coalesce(nullif(i->>'precio_unitario','')::numeric, 0)), 0)
    into v_suma
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  if coalesce(p_itbis_incluido, false) then
    v_total := v_suma;
    v_subtotal := round(v_suma / 1.18, 2);
    v_itbis := v_total - v_subtotal;
  else
    v_subtotal := v_suma;
    v_itbis := round(v_subtotal * 0.18, 2);
    v_total := v_subtotal + v_itbis;
  end if;

  insert into sgc.solicitudes_compra
    (proyecto_id, solicitante_id, estado, notas, categoria, titulo, urgencia, itbis_incluido, subtotal, itbis, total)
  values
    (p_proyecto_id, auth.uid(), 'borrador', p_notas, 'tecnologia', nullif(trim(p_titulo), ''),
     coalesce(nullif(p_urgencia, ''), 'normal'), coalesce(p_itbis_incluido, false), v_subtotal, v_itbis, v_total)
  returning id into v_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, foto_path, precio_unitario, unidad)
  select v_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido', i->>'foto_path',
         nullif(i->>'precio_unitario', '')::numeric, nullif(i->>'unidad', '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  return v_id;
end;
$$;
grant execute on function sgc.crear_solicitud_compra_tec(text, jsonb, text, text, uuid, boolean) to authenticated;

commit;
