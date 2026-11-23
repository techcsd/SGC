begin;
drop table if exists sgc.doc_qr_escaneos;
delete from sgc.parametros where clave in ('doc_qr_requisicion_activo', 'doc_qr_vigencia_dias');
commit;
