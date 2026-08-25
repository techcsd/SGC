-- ============================================================================
-- AY4 — Consolidar "Ingeniero de Campo" + "Ingeniero de Oficina" en un solo rol
-- "Ingenieros" (decisión Xaviel: hacen lo mismo; Jefe de Ingenieros queda aparte).
--
-- Se CONSERVA el código `ingeniero_campo` como canónico (varias whitelists de
-- elegibilidad/confirmación referencian ese string; renombrar el CÓDIGO las
-- rompería). Solo cambia el NOMBRE visible a "Ingenieros" y su set de accesos.
-- Los usuarios de `ingeniero_oficina` se migran al rol unificado y el rol de
-- oficina se retira. Las CSV que citan 'ingeniero_oficina' degradan sin daño
-- (ningún usuario tendrá ya ese código; el rol unificado ya está en las listas
-- de obra por su código canónico).
-- ============================================================================

begin;
set local search_path = sgc, public;

-- 1) Rol unificado: nombre + módulos + permisos (aplica decisiones AY3/AY4).
--    Módulos: bitácora, ingeniería, producción de obra, documentos, tareas.
--    (SIN `compras` completo — AY3; SIN `proyectos` completo — se ve scoped por
--     submódulo.) Permisos scoped: ficha/cronograma/personal + originar requis.
update sgc.roles
   set nombre  = 'Ingenieros',
       modulos = array['bitacora','ingenieria','obra','documentos','tareas'],
       permisos = coalesce(permisos, '{}'::jsonb) || jsonb_build_object(
                    'proyectos.obras', 'ver',
                    'proyectos.cronograma', 'ver',
                    'proyectos.personal', 'operar',
                    'compras.solicitudes', 'operar'
                  ),
       descripcion = 'Ingenieros de obra (campo y oficina unificados): bitácora, solicitud de movimiento, producción de obra, documentos y tareas; ven la ficha/cronograma/personal y requisiciones de SUS obras. Los costos/contratos quedan para oficina/gerencia.'
 where codigo = 'ingeniero_campo';

-- 2) Migrar usuarios de `ingeniero_oficina` al rol unificado (sin duplicar).
insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
select ur.usuario_id, (select id from sgc.roles where codigo = 'ingeniero_campo'), ur.asignado_por
from sgc.usuarios_roles ur
where ur.rol_id = (select id from sgc.roles where codigo = 'ingeniero_oficina')
  and not exists (
    select 1 from sgc.usuarios_roles x
    where x.usuario_id = ur.usuario_id
      and x.rol_id = (select id from sgc.roles where codigo = 'ingeniero_campo')
  );

delete from sgc.usuarios_roles
where rol_id = (select id from sgc.roles where codigo = 'ingeniero_oficina');

-- 3) Retirar el rol de oficina (ya sin usuarios). Las whitelists que lo citan
--    por string degradan sin daño.
delete from sgc.roles where codigo = 'ingeniero_oficina';

commit;
