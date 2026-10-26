-- Solo ejecutar con fixture.sql en PostgreSQL local desechable.
create temp table resultados(etiqueta text primary key);
grant select,insert on resultados to authenticated,service_role;
create function pg_temp.ok(condicion boolean, etiqueta text) returns void language plpgsql as $$
begin
  if condicion is distinct from true then raise exception 'FAIL: %',etiqueta; end if;
  insert into resultados values(etiqueta);
end; $$;
create function pg_temp.falla(sentencia text, codigo text, etiqueta text) returns void language plpgsql as $$
begin
  begin
    execute sentencia;
  exception when others then
    if sqlstate=codigo then perform pg_temp.ok(true,etiqueta); return; end if;
    raise exception 'FAIL %: esperado %, recibido % (%)',etiqueta,codigo,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % no rechazó la operación',etiqueta;
end; $$;

-- Columnas antiguas y privilegios anteriores intactos.
select pg_temp.ok(not exists(
  select table_name,column_name,data_type,is_nullable,column_default from public.test_existing_columns
  except select table_name,column_name,data_type,is_nullable,column_default
  from information_schema.columns where table_schema='sgc'
),'columnas antiguas preservadas');
select pg_temp.ok(not exists(
  select * from public.test_existing_grants
  except select table_name,grantee,privilege_type from information_schema.table_privileges where table_schema='sgc'
),'grants antiguos preservados');
select pg_temp.ok((select count(*)=11 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='sgc' and obj_description(c.oid,'pg_class')='SGC Odoo foundation v1' and c.relrowsecurity),'RLS en todas las tablas nuevas');
select pg_temp.ok((select count(*)=61 and bool_and(not a.attnotnull and not a.atthasdef)
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='sgc' and a.attnum>0 and not a.attisdropped
 and col_description(c.oid,a.attnum)='SGC Odoo foundation v1'),'61 columnas opcionales sin defaults');
do $$ declare t text; begin
  foreach t in array array['odoo_instancias','odoo_companias','odoo_documentos','odoo_lineas','odoo_recepcion_asignaciones','odoo_eventos','odoo_intentos','odoo_cursores','odoo_politicas','odoo_conciliaciones','odoo_desfases'] loop
    perform pg_temp.ok(not has_table_privilege('authenticated','sgc.'||t,'SELECT,INSERT,UPDATE,DELETE'),'sin acceso authenticated: '||t);
    perform pg_temp.ok(not has_table_privilege('anon','sgc.'||t,'SELECT,INSERT,UPDATE,DELETE'),'sin acceso anon: '||t);
  end loop;
  perform pg_temp.ok(not has_function_privilege('authenticated','sgc.odoo_v1_reclamar_eventos(uuid,text,integer,integer)','EXECUTE'),'RPC privada');
end; $$;

set role authenticated;
insert into sgc.proveedores(id,nombre,odoo_ref) values('10000000-0000-0000-0000-000000000001','Legacy','__export__.legacy');
update sgc.proveedores set nombre='Legacy editado',odoo_ref='__export__.actualizado' where id='10000000-0000-0000-0000-000000000001';
insert into sgc.articulos(id,unidad) values('10000000-0000-0000-0000-000000000002','79');
-- Una unidad histórica irregular no queda bloqueada por una FK nueva.
reset role;
select pg_temp.ok((select odoo_ref='__export__.actualizado' and odoo_id is null from sgc.proveedores where id='10000000-0000-0000-0000-000000000001'),'legacy e importador odoo_ref intactos');
select pg_temp.ok((select unidad='79' from sgc.articulos where id='10000000-0000-0000-0000-000000000002'),'unidad textual histórica preservada');

set role service_role;
insert into sgc.odoo_instancias(id,nombre,base_url,base_datos,entorno) values
 ('20000000-0000-0000-0000-000000000001','Test A','https://test.invalid','a','dev'),
 ('20000000-0000-0000-0000-000000000002','Test B','https://test.invalid','b','dev');
insert into sgc.odoo_companias values('20000000-0000-0000-0000-000000000001',1,'Test',true);
update sgc.proveedores set odoo_instancia_id='20000000-0000-0000-0000-000000000001',odoo_compania_id=1,odoo_id=501 where id='10000000-0000-0000-0000-000000000001';
insert into sgc.proveedores(id,odoo_instancia_id,odoo_id) values('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',501);
insert into sgc.articulos(id,odoo_instancia_id,odoo_product_id,odoo_template_id) values
 ('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',601,600),
 ('10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001',602,600);
insert into sgc.categorias_inventario(id,odoo_instancia_id,odoo_id) values(1,'20000000-0000-0000-0000-000000000001',9);
insert into sgc.unidades(id,odoo_instancia_id,odoo_id,odoo_factor) values
 (1,'20000000-0000-0000-0000-000000000001',3,1),(2,'20000000-0000-0000-0000-000000000001',3,1);
reset role;
select pg_temp.ok((select count(*)=2 from sgc.articulos where odoo_template_id=600),'plantilla compartida por variantes');
select pg_temp.ok((select count(*)=2 from sgc.unidades where odoo_id=3),'alias de unidad permitidos');

do $$ begin
  execute 'set local role authenticated';
  perform pg_temp.falla('update sgc.proveedores set odoo_id=999','42501','cliente no altera IDs existentes');
  perform pg_temp.falla('insert into sgc.proveedores(odoo_id) values(999)','42501','cliente no inyecta ID al insertar');
  perform pg_temp.falla('select * from sgc.odoo_eventos','42501','cliente no lee eventos');
  execute 'reset role';
  execute 'set local role service_role';
  perform pg_temp.falla('insert into sgc.proveedores(odoo_id) values(99)','23514','ID requiere contexto');
  perform pg_temp.falla($q$insert into sgc.proveedores(odoo_instancia_id,odoo_id) values('20000000-0000-0000-0000-000000000001',-1)$q$,'23514','ID positivo');
  perform pg_temp.falla($q$insert into sgc.proveedores(odoo_instancia_id,odoo_id) values('20000000-0000-0000-0000-000000000001',501)$q$,'23505','identidad única por instancia');
  perform pg_temp.falla($q$insert into sgc.proveedores(odoo_instancia_id,odoo_compania_id,odoo_id) values('20000000-0000-0000-0000-000000000002',1,502)$q$,'23503','compañía de la misma instancia');
  perform pg_temp.falla($q$insert into sgc.unidades(id,odoo_instancia_id,odoo_factor) values(5,'20000000-0000-0000-0000-000000000001',0)$q$,'23514','factor positivo');
  perform pg_temp.falla($q$insert into sgc.unidades(id,odoo_instancia_id,odoo_factor) values(6,'20000000-0000-0000-0000-000000000001','NaN')$q$,'23514','factor NaN rechazado');
  perform pg_temp.falla($q$update sgc.odoo_instancias set base_datos='otra' where id='20000000-0000-0000-0000-000000000001'$q$,'23514','contexto de instancia inmutable');
  execute 'reset role';
end; $$;

-- Escrituras no relacionadas con Odoo siguen admitidas incluso tras vincular.
set role authenticated;
update sgc.proveedores set nombre='Nombre posterior' where id='10000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select nombre='Nombre posterior' and odoo_id=501 from sgc.proveedores where id='10000000-0000-0000-0000-000000000001'),'edición legacy tras vincular');

set role service_role;
insert into sgc.ordenes_compra(id) values('30000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000002');
insert into sgc.orden_compra_items(id,orden_id) values('31000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into sgc.odoo_documentos(id,instancia_id,modelo,odoo_id,etapa,orden_compra_id) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','stock.picking',701,'recepcion','30000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','stock.picking',702,'recepcion','30000000-0000-0000-0000-000000000002');
insert into sgc.odoo_lineas(documento_id,instancia_id,modelo,odoo_id,orden_compra_item_id) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','stock.move',801,'31000000-0000-0000-0000-000000000001');
insert into sgc.entradas_inventario(id) values('50000000-0000-0000-0000-000000000001');
insert into sgc.odoo_documentos(instancia_id,modelo,odoo_id,etapa,entrada_id) values
 ('20000000-0000-0000-0000-000000000001','stock.picking',901,'recibido','50000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000001','stock.picking',902,'pendiente','50000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.ok((select count(*)=2 from sgc.odoo_documentos where entrada_id='50000000-0000-0000-0000-000000000001'),'recepción con múltiples documentos ERP');
do $$ begin
  execute 'set local role service_role';
  perform pg_temp.falla($q$insert into sgc.odoo_lineas(documento_id,instancia_id,modelo,odoo_id,orden_compra_item_id) values('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','stock.move',802,'31000000-0000-0000-0000-000000000001')$q$,'23514','línea de otra cabecera rechazada');
  perform pg_temp.falla($q$insert into sgc.odoo_lineas(documento_id,instancia_id,modelo,odoo_id,orden_compra_item_id) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','stock.move',802,'31000000-0000-0000-0000-000000000001')$q$,'23514','línea de otra instancia rechazada');
  execute 'reset role';
end; $$;
set role authenticated;
delete from sgc.entradas_inventario where id='50000000-0000-0000-0000-000000000001';
delete from sgc.orden_compra_items where id='31000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*)=2 from sgc.odoo_documentos where sgc_id='50000000-0000-0000-0000-000000000001' and entrada_id is null and origen_borrado_en is not null),'delete legacy permitido y documento conservado');
select pg_temp.ok((select count(*)=1 from sgc.odoo_lineas where sgc_id='31000000-0000-0000-0000-000000000001' and orden_compra_item_id is null and origen_borrado_en is not null),'delete línea legacy permitido y vínculo conservado');
select pg_temp.ok(not has_table_privilege('service_role','sgc.odoo_eventos','TRUNCATE,REFERENCES,TRIGGER'),'backend sin privilegios heredados adicionales');

-- La nueva relación tampoco bloquea DELETE de una unidad antes eliminable.
set role service_role;
insert into sgc.unidades(id) values(77);
insert into sgc.entradas_inventario(id,orden_compra_id) values('50000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001');
insert into sgc.detalle_entradas(id,entrada_id,articulo_id) values('51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into sgc.orden_compra_items(id,orden_id) values('31000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001');
insert into sgc.odoo_recepcion_asignaciones(detalle_entrada_id,orden_compra_item_id,cantidad,unidad_id) values('51000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002',2,77);
reset role;
set role authenticated;
-- Edición legacy posterior: el vínculo es histórico y el worker debe detectar el desfase.
update sgc.entradas_inventario set orden_compra_id='30000000-0000-0000-0000-000000000002' where id='50000000-0000-0000-0000-000000000002';
delete from sgc.unidades where id=77;
reset role;
select pg_temp.ok((select unidad_id is null and unidad_origen_id=77 from sgc.odoo_recepcion_asignaciones where detalle_entrada_origen_id='51000000-0000-0000-0000-000000000001'),'delete unidad legacy permitido y snapshot conservado');

select pg_temp.ok(exists(select 1 from sgc.odoo_recepcion_asignaciones a join sgc.detalle_entradas d on d.id=a.detalle_entrada_id join sgc.entradas_inventario e on e.id=d.entrada_id join sgc.orden_compra_items i on i.id=a.orden_compra_item_id where e.orden_compra_id is distinct from i.orden_id),'desfase histórico detectable sin impedir DELETE de unidad');
set role authenticated;
update sgc.entradas_inventario set orden_compra_id='30000000-0000-0000-0000-000000000001' where id='50000000-0000-0000-0000-000000000002';
reset role;

-- Padre con detalles y vínculos: conservar la cascada existente sin bloquearla.
set role service_role;
insert into sgc.orden_compra_items(id,orden_id) values('31000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002');
insert into sgc.odoo_lineas(documento_id,instancia_id,modelo,odoo_id,orden_compra_item_id) values
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','stock.move',805,'31000000-0000-0000-0000-000000000003');
reset role;
set role authenticated;
delete from sgc.ordenes_compra where id='30000000-0000-0000-0000-000000000002';
reset role;
select pg_temp.ok((select origen_borrado_en is not null and orden_compra_id is null from sgc.odoo_documentos where id='40000000-0000-0000-0000-000000000002'),'borrado padre conserva documento');
select pg_temp.ok((select origen_borrado_en is not null and orden_compra_item_id is null from sgc.odoo_lineas where odoo_id=805),'cascada antigua conserva vínculo de línea');

-- Colas, orden y recuperación incierta.
set role service_role;
insert into sgc.odoo_eventos(id,instancia_id,direccion,clave_idempotencia,agregado,revision,accion) values
 ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','sgc_a_odoo','evt-1','oc-A',1,'crear'),
 ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','sgc_a_odoo','evt-2','oc-A',2,'confirmar');
reset role;
do $$ declare e sgc.odoo_eventos%rowtype; begin
  execute 'set local role service_role';
  perform pg_temp.ok((select count(*)=0 from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','w')),'instancia deshabilitada no procesa');
  update sgc.odoo_instancias set habilitada=true,permitir_salida=true where id='20000000-0000-0000-0000-000000000001';
  perform pg_temp.falla($q$insert into sgc.odoo_eventos(instancia_id,direccion,clave_idempotencia,agregado,revision,accion) values('20000000-0000-0000-0000-000000000001','sgc_a_odoo','evt-1','otro',1,'crear')$q$,'23505','idempotencia durable');
  perform pg_temp.falla($q$insert into sgc.odoo_eventos(instancia_id,direccion,clave_idempotencia,agregado,revision,accion) values('20000000-0000-0000-0000-000000000001','sgc_a_odoo','evt-otra','oc-A',1,'otra_accion')$q$,'23505','una revisión tiene una sola acción por agregado');
  select * into strict e from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','w');
  perform pg_temp.ok(e.id='60000000-0000-0000-0000-000000000001','orden por revisión');
  perform pg_temp.ok((select count(*)=0 from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','w2')),'no doble reclamación ni adelantar revisión');
  perform pg_temp.falla(format('select sgc.odoo_v1_finalizar_evento(%L,%L,%L)',e.id,gen_random_uuid(),'completado'),'55000','token incorrecto rechazado');
  perform sgc.odoo_v1_finalizar_evento(e.id,e.lease_token,'completado','{"odoo_id":123}'::jsonb);
  select * into strict e from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','w');
  perform pg_temp.ok(e.id='60000000-0000-0000-0000-000000000002','siguiente revisión tras completar');
  update sgc.odoo_eventos set lease_hasta=clock_timestamp()-interval '1 second' where id=e.id;
  perform pg_temp.falla(format('select sgc.odoo_v1_finalizar_evento(%L,%L,%L)',e.id,e.lease_token,'completado'),'55000','lease vencido no confirma');
  perform pg_temp.ok((select count(*)=0 from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','w2')),'lease vencido no reenvía');
  perform pg_temp.ok((select estado='incierto' and lease_token is null from sgc.odoo_eventos where id=e.id),'resultado incierto conservado');
  insert into sgc.odoo_eventos(instancia_id,direccion,clave_idempotencia,agregado,revision,accion) values('20000000-0000-0000-0000-000000000001','odoo_a_sgc','in-1','product-1',1,'actualizar');
  perform pg_temp.ok((select count(*)=0 from sgc.odoo_v1_reclamar_eventos('20000000-0000-0000-0000-000000000001','w2')),'entrada deshabilitada no procesa');
  execute 'reset role';
end; $$;
select count(*) as comprobaciones_correctas from resultados;
