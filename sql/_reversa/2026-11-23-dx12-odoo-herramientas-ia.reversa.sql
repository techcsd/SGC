begin;
drop function if exists sgc.odoo_estado_sincronizacion();
drop function if exists sgc.odoo_herramientas_ia_activo();
delete from sgc.parametros where clave = 'odoo_herramientas_ia';
commit;
