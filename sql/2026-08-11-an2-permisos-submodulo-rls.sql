-- =============================================================================
-- PROMPT-7 FASE 3 (AN2) — Ronda 11/08/2026 tarde. SGC padre.
-- Permisos por submódulo FUNCIONALES end-to-end (server-side) — termina AG12.
--
-- Hoy los submódulos se guardaban pero sólo `compras.proveedores`,
-- `obra.no_conformidades` y `plataforma.layout_app` se gateaban de verdad; el
-- resto salía "PRÓXIMAMENTE". Esta migración hace REAL el gating server-side de
-- los grupos priorizados por la auditoría de Xaviel: **Inventario y Flota**
-- (+ Compras).
--
-- DISEÑO (clave — evita cualquier LOOSENING):
--   Las policies granulares nuevas se apoyan en el GRANT EXPLÍCITO del submódulo
--   (columna `roles.permisos->>'mod.sub'`), NO en `puede_operar_submodulo` (que
--   por compat trata "tener el módulo padre" como operar-todo). ¿Por qué? Porque
--   los roles que YA tienen el módulo completo siguen cubiertos por sus policies
--   de módulo existentes (`is_admin OR tiene_modulo(...)`), así que reusar la
--   compat aquí sería redundante — y para `vehiculos` (cuya escritura estaba
--   restringida a `es_flota_elevado`, MÁS estricta que el módulo) habría
--   AMPLIADO el acceso a cualquier rol con módulo flota. Con grant explícito:
--     · rol con módulo completo → escribe/lee vía su policy de módulo (igual que antes).
--     · rol GRANULAR (sin el módulo) → escribe/lee sólo su submódulo, por el grant explícito.
--     · nadie pierde ni gana acceso indebido.
--   Niveles homologados: Sin acceso / Ver / Operar.
-- =============================================================================

begin;

-- Nivel EXPLÍCITO de un submódulo para el usuario actual: mejor valor en
-- roles.permisos entre sus roles, SIN compat de módulo ni de admin.
create or replace function sgc.submodulo_nivel_explicito(p_key text)
returns text
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select case
    when exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = auth.uid() and coalesce(r.permisos->>p_key,'') = 'operar'
    ) then 'operar'
    when exists (
      select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = auth.uid() and coalesce(r.permisos->>p_key,'') in ('ver','operar')
    ) then 'ver'
    else null
  end;
$$;
grant execute on function sgc.submodulo_nivel_explicito(text) to authenticated;
comment on function sgc.submodulo_nivel_explicito(text) is
  'AN2 — nivel granular EXPLÍCITO (roles.permisos) de un submódulo, sin compat de módulo/admin. Base de las policies granulares para no ampliar el acceso de los roles con módulo completo.';

do $$
declare
  -- (tabla, submódulo). Cada tabla operativa se ancla a su submódulo.
  pares text[][] := array[
    -- Inventario
    ['articulos',             'inventario.articulos'],
    ['entradas_inventario',   'inventario.entradas'],
    ['detalle_entradas',      'inventario.entradas'],
    ['salidas_inventario',    'inventario.salidas'],
    ['detalle_salidas',       'inventario.salidas'],
    ['conteos_inventario',    'inventario.conteos'],
    ['conteo_items',          'inventario.conteos'],
    -- Compras
    ['ordenes_compra',        'compras.ordenes'],
    ['orden_compra_items',    'compras.ordenes'],
    ['solicitudes_compra',    'compras.solicitudes'],
    ['solicitud_compra_items','compras.solicitudes'],
    -- Flota
    ['vehiculos',             'flota.vehiculos'],
    ['conductores',           'flota.conductores'],
    ['mantenimientos',        'flota.mantenimientos'],
    ['registros_combustible', 'flota.combustible'],
    ['rutas',                 'flota.rutas'],
    ['ruta_paradas',          'flota.rutas']
  ];
  i int;
  tbl text; sub text; read_extra text;
begin
  for i in 1 .. array_length(pares,1) loop
    tbl := pares[i][1];
    sub := pares[i][2];
    -- vehiculos: paridad con su policy de módulo (activos-only para no-elevado).
    read_extra := case when tbl = 'vehiculos' then ' and (activo = true)' else '' end;

    -- LECTURA (ver | operar, explícito)
    execute format('drop policy if exists %I on sgc.%I', 'submod ver: '||sub, tbl);
    execute format(
      'create policy %I on sgc.%I for select to authenticated using (sgc.submodulo_nivel_explicito(%L) in (''ver'',''operar'')%s)',
      'submod ver: '||sub, tbl, sub, read_extra);

    -- ESCRITURA (operar, explícito)
    execute format('drop policy if exists %I on sgc.%I', 'submod op-ins: '||sub, tbl);
    execute format(
      'create policy %I on sgc.%I for insert to authenticated with check (sgc.submodulo_nivel_explicito(%L) = ''operar'')',
      'submod op-ins: '||sub, tbl, sub);

    execute format('drop policy if exists %I on sgc.%I', 'submod op-upd: '||sub, tbl);
    execute format(
      'create policy %I on sgc.%I for update to authenticated using (sgc.submodulo_nivel_explicito(%L) = ''operar'') with check (sgc.submodulo_nivel_explicito(%L) = ''operar'')',
      'submod op-upd: '||sub, tbl, sub, sub);

    execute format('drop policy if exists %I on sgc.%I', 'submod op-del: '||sub, tbl);
    execute format(
      'create policy %I on sgc.%I for delete to authenticated using (sgc.submodulo_nivel_explicito(%L) = ''operar'')',
      'submod op-del: '||sub, tbl, sub);
  end loop;
end $$;

commit;
