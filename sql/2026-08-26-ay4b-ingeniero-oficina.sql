-- ============================================================================
-- AY4 (revisión) — separar de nuevo "Ingeniero de Oficina" del de campo.
--
-- AY4 fusionó campo + oficina en un solo rol "Ingenieros" asumiendo que hacían lo
-- mismo. Realidad (Xaviel): los ingenieros de OFICINA hacen cubicaciones/presupuesto,
-- NO son encargados de obra → necesitan ver TODAS las obras y sus COSTOS/presupuesto
-- (lo contrario del de campo, que es scoped y sin costos).
--
-- Decisión Xaviel: rol aparte. Oficina ve costos/presupuesto + todas las obras +
-- requisición/bitácora (aditivo, NO solo-lectura).
--
-- Cómo se logra sin cambiar código de app/web: el rol de oficina lleva el MÓDULO
-- `proyectos` → (a) la RLS de proyectos le muestra TODAS las obras; (b) puedeVerCostos
-- (nivel operar por módulo padre, retrocompat) le muestra el presupuesto/costos, tanto
-- en app como en web. + `compras.solicitudes: operar` (requisición) + bitacora/
-- ingenieria/documentos/tareas. NO lleva `obra` (producción de obra es de campo).
--
-- Asignación: se le pone el rol (ADITIVO, sin quitar el de campo → cero regresión) a
-- los ingenieros de campo REALES que NO son encargados de ninguna obra (= oficina).
-- Hoy eso son Angel Medina y Ramon Cabrera; Xaviel afina en Admin › Roles.
-- ============================================================================

begin;
set local search_path = sgc, public;

-- 1) (Re)crear el rol Ingeniero de Oficina.
insert into sgc.roles (codigo, nombre, modulos, permisos, descripcion)
values (
  'ingeniero_oficina',
  'Ingeniero de Oficina',
  array['proyectos','bitacora','ingenieria','documentos','tareas'],
  jsonb_build_object('compras.solicitudes','operar'),
  'Ingenieros de oficina (cubicaciones, presupuesto, oficina técnica): ven TODAS las obras y sus costos/presupuesto, crean requisiciones y bitácora. No están asignados a una obra específica (a diferencia del Ingeniero de Campo, que ve solo sus obras y sin costos).'
)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      modulos = excluded.modulos,
      permisos = excluded.permisos,
      descripcion = excluded.descripcion;

-- 2) El rol unificado pasa a ser explícitamente el de CAMPO (código intacto).
update sgc.roles
   set nombre = 'Ingeniero de Campo',
       descripcion = 'Ingenieros de campo (encargados de obra): bitácora, solicitud de movimiento, producción de obra, documentos y tareas; ven la ficha/cronograma/personal y requisiciones de SUS obras. Sin costos/presupuesto (eso es de oficina/gerencia).'
 where codigo = 'ingeniero_campo';

-- 3) Asignar Oficina (ADITIVO) a los ingenieros de campo REALES sin obra asignada.
insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
select u.id,
       (select id from sgc.roles where codigo = 'ingeniero_oficina'),
       '4b19cc4b-3dbe-40dc-8631-ef489cad0f45'  -- Xaviel (admin)
from sgc.usuarios u
where coalesce(u.activo, true) and coalesce(u.es_prueba, false) = false
  and exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id and r.codigo = 'ingeniero_campo')
  -- que no tenga ya un rol "amplio" (gerencia/proyectos/etc. ya ven todo)
  and not exists (select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id and (r.codigo = 'admin'
                 or 'proyectos'=any(r.modulos) or 'inventario'=any(r.modulos)
                 or 'compras'=any(r.modulos) or 'direccion'=any(r.modulos)))
  -- que NO sea encargado de NINGUNA obra (= oficina)
  and (select count(*) from sgc.proyectos p
        where coalesce(p.activo,true) and not coalesce(p.es_prueba,false)
          and (sgc.es_responsable_de_proyecto(p.id, u.id)
               or sgc.es_capataz_de_proyecto(p.id, u.id)
               or exists (select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id=pe.empleado_id
                          where pe.proyecto_id=p.id and e.usuario_id=u.id))) = 0
  and not exists (select 1 from sgc.usuarios_roles ur2 join sgc.roles r2 on r2.id = ur2.rol_id
              where ur2.usuario_id = u.id and r2.codigo = 'ingeniero_oficina');

commit;

-- Verificación: quién quedó como Ingeniero de Oficina.
select u.nombre, u.email
from sgc.usuarios u
join sgc.usuarios_roles ur on ur.usuario_id = u.id
join sgc.roles r on r.id = ur.rol_id
where r.codigo = 'ingeniero_oficina'
order by u.nombre;
