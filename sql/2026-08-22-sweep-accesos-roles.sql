-- Sweep de accesos post-cambios AU (22/08/2026). Aditivo e idempotente.
-- Hallazgos del barrido rol×ruta:
--   1) ingeniero_campo (12 usuarios) no tenía Producción de Obra → se le da el módulo `obra`
--      (operar en todos los obra.* + tile "Mi obra"), como los demás roles de producción.
--   2) guarda_almacen no tenía `flota` → no podía CREAR conduces en la app (solo firmar/recibir).
-- No se quita nada. Se deja traza en roles_permisos_auditoria.
set search_path = sgc, public;

update sgc.roles set modulos = array_append(modulos, 'obra')
 where codigo = 'ingeniero_campo' and not ('obra' = any (modulos));

update sgc.roles set modulos = array_append(modulos, 'flota')
 where codigo = 'guarda_almacen' and not ('flota' = any (modulos));

insert into sgc.roles_permisos_auditoria (rol_id, actor_id, cambio, at)
select r.id, a.id,
       jsonb_build_object(
         'gana', jsonb_build_array('Producción de Obra (módulo obra)'),
         'motivo', 'Sweep de accesos post-AU: ingenieros de campo sin acceso a Producción de Obra'),
       now()
  from sgc.roles r
  cross join lateral (select id from sgc.usuarios where email ilike 'tecnologia@constructorasd.com' limit 1) a
 where r.codigo = 'ingeniero_campo';

insert into sgc.roles_permisos_auditoria (rol_id, actor_id, cambio, at)
select r.id, a.id,
       jsonb_build_object(
         'gana', jsonb_build_array('Flota / Transporte (módulo flota)'),
         'motivo', 'Sweep de accesos post-AU: guarda de almacén no podía crear conduces'),
       now()
  from sgc.roles r
  cross join lateral (select id from sgc.usuarios where email ilike 'tecnologia@constructorasd.com' limit 1) a
 where r.codigo = 'guarda_almacen';

select codigo, modulos from sgc.roles where codigo in ('ingeniero_campo', 'guarda_almacen') order by codigo;
