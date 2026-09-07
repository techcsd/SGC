-- ============================================================================
-- BJ5 — 🔴 La LISTA de obras sale vacía para ingeniería (5ª vez). Arreglar la RAÍZ.
--
-- HISTORIA: AX3 → AY4 → BA1 → BF7 arreglaron SELECTORES (dropdowns) migrándolos a
--   directorio_proyectos()/proyectos_pickables(). Pero las PANTALLAS DE LISTADO
--   (bitácora historial, inventario, legal, obra avance/checklists/…, tareas,
--   proyectos lista, etc. — 21 loaders web) leen `.from('proyectos')` DIRECTO y por
--   eso NUNCA ven un contexto: dependen de la RLS de la tabla.
--
-- CAUSA: la política "proyectos: select" (2026-08-25-ay-fase5-permisos-matriz.sql)
--   exige is_admin() OR tiene_modulo('proyectos'|'transporte'|'flota') OR
--   responsable_id OR proyecto_responsables OR proyecto_empleados. Le FALTABA, frente
--   a su gemela proyectos_pickables() (BA1):
--     · los módulos amplios inventario/compras/direccion,
--     · el grant de SUBMÓDULO `proyectos.obras` (tiene_modulo NO matchea submódulos —
--       y los roles de ingeniería están sembrados justo así: ay4-rol-ingenieros,
--       ay-fase5:126, aw3-aw5-jefe-ingenieros),
--     · es_capataz_de_proyecto,
--     · la red AW1 "vacío ≠ mudo" (sin obra ligada → ve todas).
--
-- FIX (ADITIVO — no quita visibilidad a NINGÚN rol; sólo AÑADE las ramas que ya tiene
--   pickables): reescribir la política SELECT para que concuerde con
--   proyectos_pickables() (BA1). Una política, 21+ superficies de listado.
--   La política RESTRICTIVE "es_prueba: oculta a no-admin" (BA1) sigue aplicando
--   encima con AND (3-vías), así que la obra de prueba `saasasa` queda oculta a
--   no-admin salvo usuario de prueba — no se toca aquí.
--
-- Regla de checklist: aditivo y retrocompatible; ninguna acción se pinta si el guard
--   la niega (el frontend deriva "+ Nuevo proyecto" de puede_operar_submodulo).
-- ============================================================================

begin;
set local search_path = sgc, public;

-- Helper AW1 en SECURITY DEFINER: "¿el usuario NO está ligado a ninguna obra activa?".
-- CRÍTICO: la red AW1 hace `not exists (select from sgc.proyectos ...)`. Metida
-- DIRECTA en la policy de sgc.proyectos, ese subselect re-dispara la MISMA policy →
-- recursión infinita (42P17). proyectos_pickables() se salva porque es SECURITY
-- DEFINER (bypassa RLS); aquí replicamos ese blindaje en un helper DEFINER.
create or replace function sgc.usuario_sin_obra_activa_ligada()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select not exists (
    select 1 from sgc.proyectos p2
    where coalesce(p2.activo, true)
      and ( sgc.es_responsable_de_proyecto(p2.id)
         or sgc.es_capataz_de_proyecto(p2.id)
         or exists (select 1 from sgc.proyecto_empleados pe2
                    join sgc.empleados e2 on e2.id = pe2.empleado_id
                    where pe2.proyecto_id = p2.id and e2.usuario_id = auth.uid()))
  );
$$;
grant execute on function sgc.usuario_sin_obra_activa_ligada() to authenticated, service_role;

drop policy if exists "proyectos: select" on sgc.proyectos;
create policy "proyectos: select" on sgc.proyectos
  for select using (
    sgc.is_admin()
    -- Módulos amplios (mismos que pickables) + los históricos transporte/flota
    -- (se CONSERVAN: quitarlos sería una restricción, no un arreglo).
    or sgc.tiene_modulo('proyectos')
    or sgc.tiene_modulo('inventario')
    or sgc.tiene_modulo('compras')
    or sgc.tiene_modulo('direccion')
    or sgc.tiene_modulo('transporte')
    or sgc.tiene_modulo('flota')
    -- Grant de SUBMÓDULO: los roles de ingeniería tienen proyectos.obras (ver/operar)
    -- pero NO el módulo 'proyectos' completo. Esto es lo que faltaba.
    or sgc.puede_ver_submodulo('proyectos.obras')
    -- Vínculo directo con la obra (responsable/adjunto/capataz/empleado).
    or sgc.es_responsable_de_proyecto(proyectos.id)
    or sgc.es_capataz_de_proyecto(proyectos.id)
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = proyectos.id and e.usuario_id = auth.uid()
    )
    -- Red AW1 ("vacío ≠ mudo"): un usuario sin NINGUNA obra ligada ve todas — nunca
    -- una lista vacía por scoping. Vía helper DEFINER (ver nota de recursión arriba).
    or sgc.usuario_sin_obra_activa_ligada()
  );

commit;
