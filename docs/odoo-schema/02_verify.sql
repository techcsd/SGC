-- SOLO LECTURA. Ejecutar después de aplicar el esquema y en cada puesta en marcha.
select c.relname as tabla,c.relrowsecurity as rls,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as acceso_web,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as acceso_anon,
 has_table_privilege('service_role',c.oid,'TRUNCATE,REFERENCES,TRIGGER') as privilegios_backend_excesivos
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='sgc' and obj_description(c.oid,'pg_class')='SGC Odoo foundation v1'
order by c.relname;
-- Esperado: 11 filas; rls=true; los otros booleanos=false.

select table_name,count(*) as columnas_nuevas,
 bool_and(is_nullable='YES' and column_default is null) as todas_opcionales
from information_schema.columns
where table_schema='sgc' and column_name like 'odoo\_%' escape '\'
 and column_name<>'odoo_ref'
 and table_name in ('proveedores','articulos','categorias_inventario','unidades','bodegas',
   'ordenes_compra','orden_compra_items','proyectos','activos_fijos','tec_equipos','vehiculos')
group by table_name order by table_name;
-- Esperado: 11 tablas; todas_opcionales=true.

select p.proname,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as ejecutable_web,
 has_function_privilege('anon',p.oid,'EXECUTE') as ejecutable_anon,
 p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='sgc' and obj_description(p.oid,'pg_proc')='SGC Odoo foundation v1';
-- Esperado: 7 funciones; todos los booleanos=false.

select t.relname,c.conname,c.convalidated
from pg_constraint c join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='sgc' and c.conname like 'odoo_v1_%'
order by t.relname,c.conname;
-- NOT VALID evita el escaneo inicial; 03_validate_constraints.sql valida después.

select nombre,entorno,habilitada,permitir_salida,permitir_entrada from sgc.odoo_instancias;
-- Una instalación inicial no añade ninguna fila ni habilita conexiones.

-- Los vínculos son snapshots de identidad. No reutilizar una línea cuyo padre cambió.
-- Esperado antes de publicar: CERO filas de este conjunto.
select l.id as vinculo,l.tipo_sgc,l.sgc_id,l.documento_id,'padre local cambió' as motivo
from sgc.odoo_lineas l join sgc.odoo_documentos d on d.id=l.documento_id
left join sgc.orden_compra_items oc on oc.id=l.orden_compra_item_id
left join sgc.detalle_entradas de on de.id=l.detalle_entrada_id
left join sgc.detalle_salidas ds on ds.id=l.detalle_salida_id
left join sgc.conteo_items ci on ci.id=l.conteo_item_id
left join sgc.retiro_material_items ri on ri.id=l.retiro_item_id
where l.origen_borrado_en is null and
 ((l.orden_compra_item_id is not null and oc.orden_id is distinct from d.orden_compra_id)
 or (l.detalle_entrada_id is not null and de.entrada_id is distinct from d.entrada_id)
 or (l.detalle_salida_id is not null and ds.salida_id is distinct from d.salida_id)
 or (l.conteo_item_id is not null and ci.conteo_id is distinct from d.conteo_id)
 or (l.retiro_item_id is not null and ri.retiro_id is distinct from d.retiro_id));

select a.id as asignacion,'orden local cambió' as motivo
from sgc.odoo_recepcion_asignaciones a
join sgc.detalle_entradas de on de.id=a.detalle_entrada_id
join sgc.entradas_inventario e on e.id=de.entrada_id
join sgc.orden_compra_items oi on oi.id=a.orden_compra_item_id
where e.orden_compra_id is not null and e.orden_compra_id is distinct from oi.orden_id;

select direccion,estado,count(*) as cantidad from sgc.odoo_eventos group by direccion,estado;
select tipo_sgc,count(*) as origenes_borrados from sgc.odoo_documentos
where origen_borrado_en is not null group by tipo_sgc;
