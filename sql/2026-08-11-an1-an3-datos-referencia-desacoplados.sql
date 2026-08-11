-- =============================================================================
-- PROMPT-7 FASE 1 (AN1 + AN3) — Ronda 11/08/2026 tarde. SGC padre.
--
-- REGLA ARQUITECTÓNICA (raíz de AN1 y AN3):
--   Separar dos cosas que hoy estaban mezcladas en la RLS:
--     (1) ACCESO AL MÓDULO  → ver/administrar las pantallas de Inventario, RRHH…
--     (2) LECTURA DE DATOS DE REFERENCIA → catálogos que los FLUJOS operativos
--         necesitan (almacenes, obras, artículos + existencias, empleados/
--         usuarios para asignar o compartir).
--   Quitarle un módulo a un rol NO puede romper los flujos que consumen esos
--   catálogos. La lectura de referencia expone SOLO lo operativo (nombre/ID y lo
--   mínimo del flujo), nunca la data sensible del módulo.
--
-- SÍNTOMAS QUE ARREGLA:
--   · AN3 — al quitarle el módulo Inventario al rol Chofer, en la app el listado
--           de almacenes de origen (crear conduce) y los materiales salían VACÍOS.
--           Causa: `bodegas`/`stock_por_bodega` SELECT sólo permitían módulo
--           inventario/compras; el chofer (flota+transporte) quedaba fuera.
--   · AN1 — con el rol SOLO "Tecnología", en inventario tecnológico los dropdowns
--           de Ubicación (almacenes) y "Asignado a" (empleados) salían VACÍOS.
--           Causa: `bodegas` (módulo) y `empleados` (own OR rrhh) no legibles.
--
-- ENFOQUE (aditivo, retrocompatible):
--   A) Tablas de referencia SIN columnas sensibles (bodegas, stock_por_bodega):
--      abrir la LECTURA a cualquier usuario autenticado con una policy permisiva
--      nueva. La policy RESTRICTIVE de `es_prueba` sigue ocultando los datos de
--      prueba a los no-admin (AND), y las policies de ESCRITURA no se tocan.
--   B) Tablas de referencia CON columnas sensibles (empleados: salario/banco/…;
--      usuarios; proyectos: presupuesto): NO se abre la tabla. Se exponen
--      funciones SECURITY DEFINER de "directorio" que devuelven sólo el subconjunto
--      seguro (id + nombre + lo operativo), como ya existía `directorio_usuarios()`.
--
-- Matriz flujo × dato de referencia × rol → documentada en el resumen final.
-- =============================================================================

begin;

-- ── A) Referencia SIN datos sensibles: abrir SELECT a autenticados ────────────
-- bodegas: nombre/obra/activo/geo del almacén. Nada sensible. El flujo de conduce
-- (chofer) y el de ubicación (inventario tecnológico) lo necesitan.
drop policy if exists "bodegas: referencia autenticados" on sgc.bodegas;
create policy "bodegas: referencia autenticados" on sgc.bodegas
  for select to authenticated
  using (auth.uid() is not null);
comment on policy "bodegas: referencia autenticados" on sgc.bodegas is
  'AN3 — lectura de referencia: cualquier usuario autenticado ve los almacenes (dato operativo de conduces/ubicaciones), independiente del módulo Inventario. es_prueba RESTRICTIVE sigue ocultando pruebas a no-admin.';

-- stock_por_bodega: existencias por almacén. Dato operativo del flujo de conduce
-- (elegir materiales con existencia). No es sensible en un ERP interno.
drop policy if exists "stock_por_bodega: referencia autenticados" on sgc.stock_por_bodega;
create policy "stock_por_bodega: referencia autenticados" on sgc.stock_por_bodega
  for select to authenticated
  using (auth.uid() is not null);
comment on policy "stock_por_bodega: referencia autenticados" on sgc.stock_por_bodega is
  'AN3 — lectura de referencia: existencias por almacén para armar conduces, independiente del módulo Inventario.';

-- articulos ya es legible por todos (policy `articulos: read` using true) — OK.

-- ── B) Referencia CON datos sensibles: directorios SECURITY DEFINER ───────────

-- Empleados → sólo el subconjunto seguro para dropdowns "Asignado a" / selects.
-- (NO expone salario, banco, cédula, TSS, contacto de emergencia, etc.)
create or replace function sgc.directorio_empleados()
returns table (id uuid, nombre text, apellido text, cargo text, activo boolean, usuario_id uuid)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select e.id, e.nombre, e.apellido, e.cargo, e.activo, e.usuario_id
  from sgc.empleados e
  where coalesce(e.activo, true)
    and (not coalesce(e.es_prueba, false) or sgc.is_admin())
  order by e.nombre, e.apellido;
$$;
grant execute on function sgc.directorio_empleados() to authenticated;
comment on function sgc.directorio_empleados() is
  'AN1 — directorio de referencia de empleados (id, nombre, apellido, cargo, activo, usuario_id) para selects "Asignado a". SECURITY DEFINER: legible por cualquier autenticado sin abrir la tabla empleados (que tiene columnas sensibles). Oculta prueba a no-admin.';

-- Usuarios (detalle) → nombre + correo + rol(es) + avatar para listas de
-- compartidos (Notas), participantes (Mensajes) y asignaciones. Amplía el
-- directorio_usuarios() existente (que sólo daba id+nombre) sin romperlo.
create or replace function sgc.directorio_usuarios_detalle()
returns table (id uuid, nombre text, email text, avatar_path text, activo boolean, roles text[])
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.id, u.nombre::text, u.email::text, u.avatar_path, u.activo,
         coalesce(
           (select array_agg(r.nombre order by r.nombre)
              from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
             where ur.usuario_id = u.id),
           array[]::text[]) as roles
  from sgc.usuarios u
  where coalesce(u.activo, true)
  order by u.nombre;
$$;
grant execute on function sgc.directorio_usuarios_detalle() to authenticated;
comment on function sgc.directorio_usuarios_detalle() is
  'AN1/AN7 — directorio de referencia enriquecido de usuarios (id, nombre, email, avatar, roles) para listas de compartidos/participantes/asignaciones. SECURITY DEFINER: legible por cualquier autenticado sin abrir la tabla usuarios.';

-- Proyectos (obras) → subconjunto seguro (sin presupuesto/porcentaje pagado) para
-- flujos que referencian obras sin tener el módulo Proyectos.
create or replace function sgc.directorio_proyectos()
returns table (id uuid, codigo text, nombre text, estado text, ubicacion text, activo boolean)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p.id, p.codigo, p.nombre, p.estado, p.ubicacion, p.activo
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (not coalesce(p.es_prueba, false) or sgc.is_admin())
  order by p.nombre;
$$;
grant execute on function sgc.directorio_proyectos() to authenticated;
comment on function sgc.directorio_proyectos() is
  'AN3 — directorio de referencia de obras (id, codigo, nombre, estado, ubicacion, activo) para flujos que referencian obras sin el módulo Proyectos. SECURITY DEFINER, sin presupuesto/financieros.';

commit;
