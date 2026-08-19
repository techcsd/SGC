-- ============================================================================
-- PROMPT-25 (AW) — Ronda 21/08/2026.
-- AW3: rol nuevo "Jefe de Ingenieros" (supervisa a los ingenieros, solo lectura).
-- AW5: "Ver todas las bitácoras" gateado por un PERMISO DE SUBMÓDULO CONFIGURABLE
--      (`bitacora.ver_todas`) en la matriz AG12/AN2 — Xaviel puede conceder/quitar
--      ese permiso a cualquier rol desde Administración › Roles SIN tocar código.
--
-- DISEÑO (clave):
--   • "Mis bitácoras"  = las propias. Ya lo garantiza la RLS: un ingeniero normal
--     solo recibe filas con usuario_id = auth.uid() (ni por API ve ajenas).
--   • "Todas las bitácoras" = gating server-side. Antes: admin OR módulo proyectos
--     OR responsable de obra. AHORA se añade OR permiso explícito
--     `bitacora.ver_todas` (nivel ver|operar) → lista de roles EDITABLE sin deploy.
--   • Seed inicial del permiso: admin, direccion, gerencia y el nuevo
--     jefe_ingenieros. Retrocompatible: los caminos previos siguen intactos.
-- Aditivo / idempotente / retrocompatible.
-- Apply: node scratchpad/dbq.mjs --file sql/2026-08-21-aw3-aw5-jefe-ingenieros-bitacoras-ver-todas.sql
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ── 1) Rol "Jefe de Ingenieros" ─────────────────────────────────────────────
-- Reusa módulos/submódulos existentes (no es un módulo nuevo → sin array_append
-- al admin). Supervisión de solo lectura sobre lo que producen los ingenieros:
-- todas las bitácoras (bitacora.ver_todas), producción de obra, cronograma y
-- personal de obra. `on conflict` NO pisa modulos/permisos ya editados por el
-- admin — solo refresca nombre/descripción.
insert into sgc.roles (codigo, nombre, modulos, permisos, descripcion)
values (
  'jefe_ingenieros',
  'Jefe de Ingenieros',
  array['bitacora']::text[],
  jsonb_build_object(
    'bitacora.ver_todas',      'ver',
    'proyectos.obras',         'ver',
    'proyectos.cronograma',    'ver',
    'proyectos.personal',      'ver',
    'obra.plan_dia',           'ver',
    'obra.no_conformidades',   'ver',
    'obra.checklists',         'ver',
    'obra.subcontratistas',    'ver',
    'obra.avance',             'ver',
    'obra.informes',           'ver'
  ),
  'Supervisa el trabajo de los ingenieros: ve TODAS las bitácoras, incidentes/accidentes, producción de obra, cronograma y personal de obra. Solo lectura — no edita lo que hicieron otros.'
)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion;

-- ── 2) Seed del permiso `bitacora.ver_todas` en los roles supervisores ──────
-- Concede el grant explícito (roles.permisos->>'bitacora.ver_todas' = 'ver') a
-- admin/direccion/gerencia si aún no lo tienen. jefe_ingenieros ya lo trae del
-- insert de arriba. NO baja de nivel a quien ya tenga 'operar'.
update sgc.roles r
   set permisos = coalesce(r.permisos, '{}'::jsonb)
                  || jsonb_build_object('bitacora.ver_todas', 'ver')
 where r.codigo in ('admin', 'direccion', 'gerencia')
   and coalesce(r.permisos->>'bitacora.ver_todas', '') not in ('ver', 'operar');

-- ── 3) Gating server-side: añadir el permiso configurable a los 3 predicados ─
-- (a) RPC que gatea la pestaña "Todas".
create or replace function sgc.puede_ver_otras_bitacoras()
returns boolean
language sql stable security definer
set search_path to 'sgc','pg_temp'
as $$
  select sgc.is_admin()
      or sgc.submodulo_nivel_explicito('bitacora.ver_todas') is not null
      or sgc.tiene_modulo('proyectos')
      or exists (select 1 from sgc.proyectos p where p.responsable_id = auth.uid())
      or exists (select 1 from sgc.proyecto_responsables prr
                 where prr.usuario_id = auth.uid() and coalesce(prr.activo, true));
$$;
grant execute on function sgc.puede_ver_otras_bitacoras() to authenticated, service_role;

-- (b) RLS de la tabla base: quien tenga el permiso ve todas las filas.
drop policy if exists "bitacoras: select" on sgc.bitacoras;
create policy "bitacoras: select" on sgc.bitacoras for select to authenticated
  using (
    usuario_id = auth.uid()
    or sgc.is_admin()
    or sgc.submodulo_nivel_explicito('bitacora.ver_todas') is not null
    or sgc.tiene_modulo('proyectos')
    or sgc.es_responsable_de_proyecto(proyecto_id)
  );

-- (c) Espejo para las tablas hijas (actividades/restricciones/archivos/equipos).
create or replace function sgc.puede_ver_bitacora(p_bitacora_id uuid)
returns boolean
language sql stable
set search_path to 'sgc','pg_temp'
as $$
  select exists (
    select 1 from sgc.bitacoras b
    where b.id = p_bitacora_id
      and (b.usuario_id = auth.uid()
           or sgc.is_admin()
           or sgc.submodulo_nivel_explicito('bitacora.ver_todas') is not null
           or sgc.tiene_modulo('proyectos')
           or sgc.es_responsable_de_proyecto(b.proyecto_id))
  );
$$;

commit;
