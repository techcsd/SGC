begin;
drop function if exists sgc.tiendas_publicas();
delete from sgc.parametros where clave in ('tienda_play_url', 'tienda_appstore_url');
commit;
