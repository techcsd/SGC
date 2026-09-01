-- ============================================================================
-- BF7 — 🔴 El chofer no ve NINGUNA obra → no puede crear conduces ("No hay opciones").
--
-- CAUSA (confirmada): AY4 (2026-08-25-ay-fase5-permisos-matriz.sql) le puso a
--   `directorio_proyectos()` — la FUENTE COMPARTIDA de los selectores de "obra
--   destino" (conduce/ruta, web y app) — el scoping "el ingeniero ve SUS obras"
--   (whitelist de módulos proyectos/inventario/compras/direccion + responsable/
--   empleado). Un CHOFER tiene solo el módulo `transporte` y ninguna obra asignada
--   → cae fuera de todas las ramas → cero filas. Peor: a diferencia de su gemela
--   `proyectos_pickables()`, `directorio_proyectos()` NO tenía la red AW1
--   ("sin obra ligada → ve todas"). AP1 (2026-08-13) la había creado SIN scoping
--   justamente para arreglar ESTE bug; AY4 lo revivió.
--
-- FIX — MATRIZ CONTEXTO × ROL (documentada en docs/OBRAS-SELECTOR-MATRIZ.md):
--   La fuente deja de tener una regla global; declara un CONTEXTO:
--     · WIDE  (conduce destino/origen, ruta, despacho, registro de personal,
--              admin/gestión) → TODOS ven TODAS las obras activas. El chofer
--              entrega donde lo manden; almacén/logística despachan a cualquier obra.
--     · SCOPED (requisición, orden de compra, bitácora) → el ingeniero ve SUS obras
--              (AY4 se conserva); admin y módulos amplios ven todas.
--   + AW1 (vacío ≠ mudo): en contexto SCOPED, si el usuario no está ligado a
--     NINGUNA obra, ve todas — nunca un selector vacío por scoping.
--
--   El default del parámetro es 'conduce' (WIDE) → las llamadas SIN argumento que
--   ya existen (app: crear conduce / registrar personal; web: salidas) quedan
--   arregladas al aplicar esta migración, sin tocar la app.
--
-- Obras CERRADAS (activo=false, p.ej. Brisas AT20): EXCLUIDAS en todos los
--   contextos (filtro coalesce(activo,true)) — se confirma la exclusión.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- Debe DROPearse la versión 0-arg antes de crear la de 1-arg-con-default: si
-- coexisten, `rpc('directorio_proyectos')` sin args queda AMBIGUO. Con una sola
-- función (default), la llamada sin args resuelve limpio.
drop function if exists sgc.directorio_proyectos();

create or replace function sgc.directorio_proyectos(p_contexto text default 'conduce')
 returns table(id uuid, codigo text, nombre text, estado text, ubicacion text, activo boolean, latitud numeric, longitud numeric)
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  with ctx as (select lower(coalesce(nullif(p_contexto, ''), 'conduce')) as c)
  select p.id, p.codigo, p.nombre, p.estado, p.ubicacion, p.activo,
         p.latitud, p.longitud
  from sgc.proyectos p, ctx
  where coalesce(p.activo, true)
    and (not coalesce(p.es_prueba, false) or sgc.is_admin() or sgc.usuario_actual_es_prueba())
    and (
      -- WIDE — todas las obras activas para todos.
      ctx.c in ('conduce', 'ruta', 'despacho', 'logistica', 'personal', 'admin', 'gestion')
      -- SCOPED — ingeniero ve las suyas; admin y módulos amplios, todas.
      or sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('compras')   or sgc.tiene_modulo('direccion')
      or p.responsable_id = auth.uid()
      or exists (select 1 from sgc.proyecto_responsables pr
                 where pr.proyecto_id = p.id and pr.usuario_id = auth.uid()
                   and coalesce(pr.activo, true))
      or exists (select 1 from sgc.proyecto_empleados pe
                 join sgc.empleados e on e.id = pe.empleado_id
                 where pe.proyecto_id = p.id and e.usuario_id = auth.uid())
      -- AW1 — vacío ≠ mudo: sin ninguna obra ligada, ve todas.
      or not exists (
        select 1 from sgc.proyectos p2
        where coalesce(p2.activo, true)
          and ( p2.responsable_id = auth.uid()
             or exists (select 1 from sgc.proyecto_responsables pr2
                        where pr2.proyecto_id = p2.id and pr2.usuario_id = auth.uid()
                          and coalesce(pr2.activo, true))
             or exists (select 1 from sgc.proyecto_empleados pe2
                        join sgc.empleados e2 on e2.id = pe2.empleado_id
                        where pe2.proyecto_id = p2.id and e2.usuario_id = auth.uid()))
      )
    )
  order by p.nombre;
$function$;

grant execute on function sgc.directorio_proyectos(text) to authenticated, service_role;

commit;
