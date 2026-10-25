-- SOLO LECTURA. Ejecutar después de aplicar el esquema y en cada puesta en marcha.
select c.relname as tabla,c.relrowsecurity as rls,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as acceso_web,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as acceso_anon,
 has_table_privilege('service_role',c.oid,'TRUNCATE,REFERENCES,TRIGGER') as privilegios_backend_excesivos
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='sgc' and obj_description(c.oid,'pg_class')='SGC Odoo foundation v1'
order by c.relname;
-- Esperado: 2 filas; rls=true; los otros booleanos=false.

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
-- Esperado: 2 funciones; todos los booleanos=false.

select t.relname,c.conname,c.convalidated
from pg_constraint c join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='sgc' and c.conname like 'odoo_v1_%'
order by t.relname,c.conname;
-- NOT VALID evita el escaneo inicial; 03_validate_constraints.sql valida después.

select nombre,entorno,habilitada,permitir_salida,permitir_entrada from sgc.odoo_instancias;
-- Una instalación inicial no añade ninguna fila ni habilita conexiones.
