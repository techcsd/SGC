-- DK (issue #70) -- FKs que siguen sin indice tras dj4. Verificado contra prod (solo lectura):
-- 7 pares duplicados ya resueltos por dj4 (0 pares duplicados hoy); quedaban ~60 FKs sin indice
-- en tablas de >150 filas o con muchos seq scans. Aqui van SOLO las de tablas chicas/medianas
-- pero consultadas con frecuencia o con borrado/actualizacion de la fila padre (FK checks).
-- Indices PARCIALES (where col is not null): pequenos, y el planner los usa para "col = $1".
-- No se tocan columnas Odoo (odoo_instancia_id, odoo_corte_respaldo_stock).
-- "Sin uso" (0 scans) NO se borra: stats_reset de prod es 2026-06-27 (<6 meses), decision de Xaviel.
-- Aditiva. Reversa: sql/2026-11-17-dk-indices-fk-restantes_reversa.sql
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

create index if not exists ix_auditoria_impersonado_por on sgc.auditoria (impersonado_por) where impersonado_por is not null;
create index if not exists ix_agente_acciones_agente_id on sgc.agente_acciones (agente_id) where agente_id is not null;
create index if not exists ix_agente_acciones_accion_permitida_id on sgc.agente_acciones (accion_permitida_id) where accion_permitida_id is not null;
create index if not exists ix_stock_apertura_bodega_id on sgc.stock_apertura (bodega_id);
create index if not exists ix_conteo_items_articulo_id on sgc.conteo_items (articulo_id);
create index if not exists ix_app_error_reports_user_id on sgc.app_error_reports (user_id) where user_id is not null;
create index if not exists ix_detalle_salidas_articulo_id on sgc.detalle_salidas (articulo_id) where articulo_id is not null;
create index if not exists ix_detalle_salidas_origen_item_id on sgc.detalle_salidas (origen_item_id) where origen_item_id is not null;
create index if not exists ix_solicitud_material_items_articulo_id on sgc.solicitud_material_items (articulo_id) where articulo_id is not null;
create index if not exists ix_solicitud_material_items_articulo_despacho_id on sgc.solicitud_material_items (articulo_despacho_id) where articulo_despacho_id is not null;
create index if not exists ix_salida_firmas_usuario_id on sgc.salida_firmas (usuario_id) where usuario_id is not null;
create index if not exists ix_detalle_entradas_articulo_id on sgc.detalle_entradas (articulo_id) where articulo_id is not null;
create index if not exists ix_salidas_inventario_destino_almacen_id on sgc.salidas_inventario (destino_almacen_id) where destino_almacen_id is not null;
create index if not exists ix_entradas_inventario_bodega_id on sgc.entradas_inventario (bodega_id) where bodega_id is not null;
create index if not exists ix_entradas_inventario_orden_compra_id on sgc.entradas_inventario (orden_compra_id) where orden_compra_id is not null;
create index if not exists ix_entradas_inventario_entrada_origen_id on sgc.entradas_inventario (entrada_origen_id) where entrada_origen_id is not null;
create index if not exists ix_solicitudes_material_bodega_id on sgc.solicitudes_material (bodega_id) where bodega_id is not null;
create index if not exists ix_solicitudes_material_salida_id on sgc.solicitudes_material (salida_id) where salida_id is not null;
create index if not exists ix_solicitudes_material_solicitante_id on sgc.solicitudes_material (solicitante_id) where solicitante_id is not null;
create index if not exists ix_solicitudes_material_solicitud_compra_id on sgc.solicitudes_material (solicitud_compra_id) where solicitud_compra_id is not null;
create index if not exists ix_mensajes_autor_id on sgc.mensajes (autor_id) where autor_id is not null;
create index if not exists ix_registros_combustible_conciliacion_id on sgc.registros_combustible (conciliacion_id) where conciliacion_id is not null;
create index if not exists ix_comb_trans_prov_registro_id on sgc.combustible_transacciones_proveedor (registro_id) where registro_id is not null;
create index if not exists ix_comb_trans_prov_conciliacion_id on sgc.combustible_transacciones_proveedor (conciliacion_id) where conciliacion_id is not null;
create index if not exists ix_comb_trans_prov_vehiculo_id on sgc.combustible_transacciones_proveedor (vehiculo_id) where vehiculo_id is not null;
create index if not exists ix_conc_comb_detalle_registro_id on sgc.conciliacion_combustible_detalle (registro_id) where registro_id is not null;
create index if not exists ix_conc_comb_detalle_vehiculo_id on sgc.conciliacion_combustible_detalle (vehiculo_id) where vehiculo_id is not null;
create index if not exists ix_usuarios_roles_rol_id on sgc.usuarios_roles (rol_id);
create index if not exists ix_usuarios_fusionado_en on sgc.usuarios (fusionado_en) where fusionado_en is not null;
create index if not exists ix_audit_log_actor_id on sgc.audit_log (actor_id) where actor_id is not null;
commit;
