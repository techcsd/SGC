-- Reversa de EA1 (proveedores de tecnología). DESTRUCTIVA: borra los datos de proveedores.
-- Los textos libres originales (tec_cotizaciones.proveedor, adjuntos, ítems) NO se tocaron, así que no se pierde nada previo.
begin;
set local search_path = sgc, public;

drop function if exists sgc.tec_proveedor_detalle_asistente(uuid);
drop function if exists sgc.tec_proveedor_desvincular(uuid, uuid);
drop function if exists sgc.tec_proveedor_vincular(uuid, uuid, uuid);
drop function if exists sgc.tec_proveedor_crear_desde_cotizacion(uuid, text);
drop function if exists sgc.tec_proveedores_por_revisar();
drop function if exists sgc.buscar_tec_proveedores(text, boolean);

drop policy if exists "tec-proveedores: lectura" on storage.objects;
drop policy if exists "tec-proveedores: subida" on storage.objects;
drop policy if exists "tec-proveedores: actualizar" on storage.objects;
drop policy if exists "tec-proveedores: borrar" on storage.objects;
-- El bucket solo se borra si está vacío (Storage lo impide si tiene objetos).
delete from storage.buckets where id = 'tec-proveedores'
  and not exists (select 1 from storage.objects where bucket_id = 'tec-proveedores');

alter table sgc.solicitudes_compra drop column if exists proveedor_tec_id;
alter table sgc.tec_cotizaciones drop column if exists proveedor_id;

drop table if exists sgc.tec_proveedor_facturas;
drop table if exists sgc.tec_proveedor_trabajos;
drop table if exists sgc.tec_proveedor_contactos;
drop table if exists sgc.tec_proveedores;
drop table if exists sgc.tec_proveedor_categorias;

update sgc.roles set permisos = permisos - 'tecnologia.proveedores' where permisos ? 'tecnologia.proveedores';

drop function if exists sgc.tec_prov_touch();
drop function if exists sgc.tec_prov_motivo_dudoso(text);
drop function if exists sgc.tec_normalizar_proveedor(text);
drop function if exists sgc.tec_norm_busqueda(text);
commit;
