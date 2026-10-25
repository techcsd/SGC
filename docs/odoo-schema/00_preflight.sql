-- SOLO LECTURA. Ejecutar en dev antes de aplicar el paquete.
select current_database() as base,current_user as rol,version() as version,
  current_setting('transaction_read_only') as solo_lectura;

with esperadas(tabla,tipo) as (values
 ('proveedores','uuid'),('articulos','uuid'),('categorias_inventario','integer'),
 ('unidades','integer'),('bodegas','uuid'),('ordenes_compra','uuid'),
 ('orden_compra_items','uuid'),('proyectos','uuid'),('activos_fijos','uuid'),
 ('tec_equipos','uuid'),('vehiculos','uuid'),('entradas_inventario','uuid'),
 ('salidas_inventario','uuid'),('conduces_externos','uuid'),('conteos_inventario','uuid'),
 ('retiros_material','uuid'),('detalle_entradas','uuid'),('detalle_salidas','uuid'),
 ('conteo_items','uuid'),('retiro_material_items','uuid'))
select e.tabla,e.tipo as tipo_id_esperado,format_type(a.atttypid,a.atttypmod) as tipo_id_real,
 case when a.atttypid=to_regtype(e.tipo) then 'OK' else 'DETENER: falta tabla o tipo distinto' end as resultado
from esperadas e left join pg_attribute a on a.attrelid=to_regclass('sgc.'||e.tabla)
 and a.attname='id' and not a.attisdropped order by e.tabla;

-- Colisiones: fuera de odoo_ref, una instalación nueva no debe tener estas columnas.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='sgc' and column_name like 'odoo\_%' escape '\'
order by table_name,ordinal_position;

-- Revisar estas funciones si aparecen: retornos SQL dependientes de SELECT *
-- o INSERT sin lista de columnas pueden requerir fijar su proyección antes de migrar.
select p.proname,pg_get_function_identity_arguments(p.oid) as firma,
 pg_get_function_result(p.oid) as retorno
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='sgc' and p.prokind='f'
 and pg_get_functiondef(p.oid) ~* '(proveedores|articulos|categorias_inventario|unidades|bodegas|ordenes_compra|orden_compra_items|proyectos|activos_fijos|tec_equipos|vehiculos)'
 and (pg_get_functiondef(p.oid) ~* 'select[[:space:]]+([[:alnum:]_]+[.])?[*]'
      or pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+sgc[.][[:alnum:]_]+[[:space:]]+(select|values)')
order by p.proname,firma;

-- Los roles actuales se mantienen; el integrador ya necesita acceso a sgc.
select rolname,rolbypassrls,rolsuper from pg_roles
where rolname in ('postgres','anon','authenticated','service_role','supabase_admin');
select has_schema_privilege('service_role','sgc','USAGE') as backend_puede_usar_sgc;

-- La exportación de estos resultados no debe incluir contraseñas ni tokens.
