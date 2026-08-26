-- ============================================================================
-- AY4 (follow-up) — proyectos_pickables: scoping por rol SIN romper a nadie.
--
-- Problema: el RPC (usado por los dropdowns de obra de bitácora + requisición en la
-- APP — NO lo consume la web) trataba como "amplios" a los módulos de CAMPO
-- (obra/bitacora/flota/transporte) → un ingeniero/capataz veía TODAS las obras en
-- vez de las suyas. Y le faltaba el scoping de responsables N:M (AV3) y de capataz.
--
-- Fix: alinear el set "amplio" con directorio_proyectos (admin/proyectos/inventario/
-- compras/direccion = oficina/gestión → todas), y para el resto (campo) mostrar SOLO
-- sus obras vía es_responsable_de_proyecto (responsable_id + proyecto_responsables) /
-- es_capataz_de_proyecto / proyecto_empleados.
--
-- Red de seguridad AW1 ("vacío ≠ error"): si un usuario NO está ligado a NINGUNA obra
-- (hay ingenieros/capataces sin asignación en los datos), NO se le deja el selector
-- vacío → ve todas (como antes). Al asignarle su obra, se acota solo. Cero regresión:
-- ningún usuario pasa de N obras a 0. Retrocompatible (misma firma y columnas).
--
-- Ámbito: SOLO móvil (grep confirmó 0 consumidores en la web/edge). Aditivo.
-- ============================================================================

begin;
set local search_path = sgc, public;

create or replace function sgc.proyectos_pickables()
returns table(id uuid, nombre text, responsable_nombre text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select p.id, p.nombre::text, p.responsable_nombre::text
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (sgc.is_admin() or not coalesce(p.es_prueba, false))
    and (
      -- Oficina/gestión: ven TODAS las obras (mismo set que directorio_proyectos, AY4).
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('compras')   or sgc.tiene_modulo('direccion')
      -- Campo: SOLO sus obras (responsable/adjunto AV3, capataz, o empleado de obra).
      or sgc.es_responsable_de_proyecto(p.id)
      or sgc.es_capataz_de_proyecto(p.id)
      or exists (
        select 1 from sgc.proyecto_empleados pe
        join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id = p.id and e.usuario_id = auth.uid())
      -- AW1 — si NO está ligado a ninguna obra, ve todas (nunca un selector vacío).
      or not exists (
        select 1 from sgc.proyectos p2
        where coalesce(p2.activo, true)
          and (
            sgc.es_responsable_de_proyecto(p2.id)
            or sgc.es_capataz_de_proyecto(p2.id)
            or exists (
              select 1 from sgc.proyecto_empleados pe2
              join sgc.empleados e2 on e2.id = pe2.empleado_id
              where pe2.proyecto_id = p2.id and e2.usuario_id = auth.uid())
          ))
    )
  order by p.nombre;
$function$;

grant execute on function sgc.proyectos_pickables() to authenticated, service_role;

commit;
