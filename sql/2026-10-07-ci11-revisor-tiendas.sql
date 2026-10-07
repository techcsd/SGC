-- 2026-10-07-ci11-revisor-tiendas.sql
-- CI11 — Rol "revisor_tiendas" para la revisión de Google Play / App Store, con
-- visibilidad ACOTADA a datos de prueba (OBRA DEMO), nunca datos reales.
--
-- Diseño (justificación): reusamos la infraestructura es_prueba existente.
--  · El revisor es un usuario es_prueba=true y los datos demo son es_prueba=true.
--  · Las políticas RESTRICTIVAS existentes de es_prueba (NOT es_prueba OR is_admin OR
--    usuario_actual_es_prueba) NO confinan al revisor (usuario_actual_es_prueba=true
--    le deja ver todo). Por eso añadimos UNA política RESTRICTIVA extra por tabla que
--    exige es_prueba cuando el usuario es revisor → el revisor SOLO ve filas de prueba.
--  · Como el revisor y su data son es_prueba, el filtro AU18 ya los excluye de
--    Seguimiento real, KPIs, incentivos y notificaciones a personas reales.
-- Aditivo: la política nueva solo RESTRINGE al revisor; nadie más cambia.
--   node scripts/apply-migration.mjs sql/2026-10-07-ci11-revisor-tiendas.sql --env dev

-- ── Rol ──────────────────────────────────────────────────────────────────────────
insert into sgc.roles (codigo, nombre, descripcion, modulos, es_operativo, comparte_ubicacion, permisos)
values (
  'revisor_tiendas', 'Revisor de tiendas',
  'Cuenta de solo lectura para la revisión de Google Play / App Store. Ve únicamente la OBRA DEMO (datos de prueba).',
  array['bitacora','inventario','flota','compras']::text[], false, false,
  '{"flota.vehiculos":"ver","flota.conductores":"ver","flota.combustible":"ver","flota.rutas":"ver","inventario.articulos":"ver","compras.ordenes":"ver"}'::jsonb
)
on conflict (codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion, modulos = excluded.modulos,
  es_operativo = excluded.es_operativo, comparte_ubicacion = excluded.comparte_ubicacion, permisos = excluded.permisos;

-- ── Helper: ¿el usuario actual es revisor de tiendas? ────────────────────────────
create or replace function sgc.es_revisor_tiendas()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo = 'revisor_tiendas'
  );
$function$;
grant execute on function sgc.es_revisor_tiendas() to authenticated, service_role;

-- ── Confinamiento: el revisor SOLO ve filas es_prueba en toda tabla que lo tenga ──
-- Política RESTRICTIVA (AND con las demás): para no-revisores es un no-op
-- (not es_revisor = true); para el revisor exige es_prueba.
do $$
declare t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'sgc' and c.column_name = 'es_prueba'
      and tb.table_type = 'BASE TABLE'
  loop
    execute format('drop policy if exists revisor_solo_demo on sgc.%I', t);
    execute format(
      'create policy revisor_solo_demo on sgc.%I as restrictive for select to authenticated using ((not sgc.es_revisor_tiendas()) or es_prueba)',
      t
    );
  end loop;
end $$;
