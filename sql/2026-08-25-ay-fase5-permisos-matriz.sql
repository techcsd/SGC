-- ============================================================================
-- AY FASE 5 — Matriz de permisos por rol/submódulo (AY3, AY4, AY6).
--   AY5 (menú=guard a nivel submódulo) va en el frontend (shell.ts canAccessChild).
--
--   AY6 — "Desempeño de choferes" daba toast rojo para Logística. Causa REAL:
--         `incentivo_listado` tiene DOS overloads (2-arg viejo + 3-arg AX5 con
--         default). El cliente llama con {p_anio, p_semana} → AMBIGÜEDAD de
--         resolución en PostgREST (ambos matchean) → error. Los grants ya están.
--         Fix: eliminar el overload 2-arg redundante; el 3-arg lo cubre (default).
--
--   AY4 — Ingenieros ven SUS obras + dropdowns se llenan:
--         (a) proyectos SELECT RLS: + responsables vía proyecto_responsables (hoy
--             solo cubría responsable_id/proyecto_empleados → los adjuntos AV3 no
--             veían su obra).
--         (b) directorio_proyectos() scope-aware: módulos amplios (admin/inventario/
--             compras/proyectos/direccion) ven todas las obras activas; el resto ve
--             SOLO sus obras (responsable/empleado). Un solo fix para todos los
--             dropdowns que lo usan (orden de compra, conduce, y los que migramos).
--
--   AY3 — Ingeniero de campo: Compras solo-lectura de SUS órdenes.
--         (a) rol ingeniero_campo: quita módulo `compras` (no gestiona órdenes/
--             proveedores) y agrega `compras.solicitudes: operar` (sigue originando
--             requisiciones) + `proyectos.obras/cronograma: ver` (AY4 secciones).
--         (b) RPC mis_ordenes_de_compra(): estado de las órdenes NACIDAS de sus
--             requisiciones (scoped a solicitante_id = auth.uid()); NO expone todas.
--
-- Aditivo salvo el drop del overload redundante y el cambio de permisos del rol
-- (intencional). Retrocompatible.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- ── AY6 — eliminar overload ambiguo de incentivo_listado ────────────────────
-- El 3-arg (p_anio, p_semana, p_incluir_prueba default true) cubre las llamadas
-- de 2 args. Quitar el 2-arg elimina la ambigüedad que rompía la pantalla.
drop function if exists sgc.incentivo_listado(integer, integer);

-- ── AY4(a) — proyectos SELECT: + responsables (proyecto_responsables) ───────
drop policy if exists "proyectos: select" on sgc.proyectos;
create policy "proyectos: select" on sgc.proyectos
  for select using (
    sgc.is_admin()
    or sgc.tiene_modulo('proyectos')
    or sgc.tiene_modulo('transporte')
    or sgc.tiene_modulo('flota')
    or responsable_id = auth.uid()
    or exists (
      select 1 from sgc.proyecto_responsables pr
      where pr.proyecto_id = proyectos.id
        and pr.usuario_id = auth.uid()
        and coalesce(pr.activo, true)
    )
    or exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = proyectos.id and e.usuario_id = auth.uid()
    )
  );

-- ── AY4(b) — directorio_proyectos() scope-aware ─────────────────────────────
-- Mismo contrato (columnas idénticas). Módulos amplios → todas las obras activas;
-- el resto → solo sus obras (responsable/adjunto/empleado). Regla AY4(c): "si un
-- rol puede usar la obra en un formulario, puede ver su ficha básica".
create or replace function sgc.directorio_proyectos()
returns table (
  id uuid, codigo text, nombre text, estado text, ubicacion text,
  activo boolean, latitud numeric, longitud numeric
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p.id, p.codigo, p.nombre, p.estado, p.ubicacion, p.activo,
         p.latitud, p.longitud
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (not coalesce(p.es_prueba, false) or sgc.is_admin())
    and (
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('inventario')
      or sgc.tiene_modulo('compras')   or sgc.tiene_modulo('direccion')
      or p.responsable_id = auth.uid()
      or exists (select 1 from sgc.proyecto_responsables pr
                 where pr.proyecto_id = p.id and pr.usuario_id = auth.uid()
                   and coalesce(pr.activo, true))
      or exists (select 1 from sgc.proyecto_empleados pe
                 join sgc.empleados e on e.id = pe.empleado_id
                 where pe.proyecto_id = p.id and e.usuario_id = auth.uid())
    )
  order by p.nombre;
$$;
grant execute on function sgc.directorio_proyectos() to authenticated;

-- ── AY3(b) — mis_ordenes_de_compra(): estado de las órdenes de MIS requisiciones ─
-- Scoped a solicitante_id = auth.uid(): NO expone todas las órdenes (la RLS de
-- ordenes_compra es módulo-wide). Devuelve el estado real de la orden que nació
-- de cada solicitud del usuario.
create or replace function sgc.mis_ordenes_de_compra()
returns table (
  solicitud_id uuid, solicitud_estado text, orden_id uuid, numero text,
  orden_estado text, proveedor text, total numeric, creada_at timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select sc.id, sc.estado, oc.id, oc.numero::text, oc.estado::text,
         prov.nombre::text, oc.total::numeric, oc.created_at
  from sgc.solicitudes_compra sc
  join sgc.ordenes_compra oc on oc.id = sc.orden_compra_id
  left join sgc.proveedores prov on prov.id = oc.proveedor_id
  where sc.solicitante_id = auth.uid()
  order by oc.created_at desc nulls last;
$$;
grant execute on function sgc.mis_ordenes_de_compra() to authenticated, service_role;

-- ── AY3(a) + AY4 — permisos del rol ingeniero_campo ─────────────────────────
-- Quita el módulo `compras` (no gestiona órdenes/proveedores) → agrega granular
-- `compras.solicitudes: operar` (sigue creando sus requisiciones; RLS lo permite
-- por submódulo) + `proyectos.obras/cronograma: ver` (ve la ficha y el cronograma
-- de SUS obras, sin costos — los costos van a nivel operar, ver FASE 5 frontend).
update sgc.roles
   set modulos = array_remove(modulos, 'compras'),
       permisos = coalesce(permisos, '{}'::jsonb)
                  || jsonb_build_object(
                       'compras.solicitudes', 'operar',
                       'proyectos.obras', 'ver',
                       'proyectos.cronograma', 'ver'
                     )
 where codigo = 'ingeniero_campo';

commit;
