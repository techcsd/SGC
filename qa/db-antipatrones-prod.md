# DB antipatrones — prod (jeeqhgccqefbqilntcpu) — 2026-11-01T14:35:00.356Z


## Resumen

| tablas | indices | politicas_rls | funciones | triggers | tam_db |
|---|---|---|---|---|---|
| 335 | 868 | 753 | 1150 | 180 | 238 MB |

## Top 25 tablas por tamaño (filas vivas, muertas, seq vs idx scans)

| relname | total | vivas | muertas | seq_scan | seq_tup_read | idx_scan | av | aa |
|---|---|---|---|---|---|---|---|---|
| chofer_posiciones | 77 MB | 261810 | 4 | 456 | 45217675 | 62148 | 2026-10-05 | 2026-10-20 |
| auditoria | 41 MB | 47284 | 44 | 106 | 812325 | 450 | 2026-10-14 | 2026-10-27 |
| domain_checks | 8352 kB | 13860 | 0 | 14 | 11748 | 4 | 2026-10-26 | 2026-10-28 |
| snap_cache | 5744 kB | 484 | 4 | 2 | 1 | 686 | — | 2026-10-23 |
| notificaciones | 5496 kB | 14132 | 2044 | 51 | 144552 | 30453 | 2026-10-19 | 2026-10-27 |
| weather_snapshots | 4112 kB | 6881 | 0 | 61 | 54807 | 542 | 2026-10-05 | 2026-10-29 |
| recorrido_diario | 3392 kB | 217 | 53 | 2 | 1 | 554 | — | 2026-10-23 |
| notif_entregas | 3168 kB | 10490 | 0 | 7 | 2271 | 13 | 2026-10-27 | 2026-10-28 |
| rutas | 2008 kB | 966 | 39 | 57229 | 25311914 | 268973 | 2026-10-28 | 2026-10-31 |
| gps_eventos | 1504 kB | 5232 | 0 | 40 | 1981 | 12937 | 2026-10-21 | 2026-10-26 |
| stock_por_bodega | 1056 kB | 3520 | 260 | 2899 | 909546 | 40225 | 2026-08-19 | 2026-10-21 |
| app_error_reports | 1040 kB | 1615 | 0 | 971 | 1217321 | 6400 | 2026-10-30 | 2026-10-20 |
| app_versiones | 968 kB | 453 | 127 | 6981 | 2097474 | 11089 | 2026-09-30 | 2026-10-26 |
| notas | 752 kB | 16 | 25 | 3928 | 27889 | 2208 | 2026-10-29 | 2026-10-29 |
| stock_apertura | 672 kB | 3472 | 95 | 93 | 246767 | 47666 | 2026-08-19 | 2026-10-01 |
| articulos | 560 kB | 286 | 40 | 3783 | 931595 | 531912 | 2026-08-21 | 2026-10-17 |
| registros_combustible | 544 kB | 315 | 0 | 5332 | 624445 | 21438 | 2026-10-30 | 2026-10-30 |
| conteo_items | 528 kB | 2512 | 0 | 7481 | 439602 | 41646 | 2026-10-17 | 2026-10-17 |
| proveedores | 528 kB | 1576 | 2 | 3430 | 2073277 | 1526 | 2026-09-25 | 2026-09-25 |
| chofer_estado_historial | 448 kB | 1815 | 0 | 52 | 15063 | 43 | 2026-10-06 | 2026-10-22 |
| avisos_flota | 432 kB | 571 | 52 | 2002 | 166294 | 64551 | 2026-10-22 | 2026-10-28 |
| incentivo_semana | 416 kB | 49 | 30 | 136 | 2690 | 2007 | 2026-10-12 | 2026-10-19 |
| bitacora_archivos | 344 kB | 1022 | 28 | 27310 | 11645202 | 10882 | — | 2026-10-27 |
| salida_firmas | 336 kB | 636 | 37 | 2327 | 645405 | 93769 | — | 2026-10-23 |
| salidas_inventario | 320 kB | 271 | 74 | 149517 | 15834785 | 1568534 | 2026-10-19 | 2026-10-28 |

## Seq scans pesados (tablas >1000 filas, seq_scan > idx_scan)

| relname | n_live_tup | seq_scan | idx_scan | seq_tup_read |
|---|---|---|---|---|
| bitacora_archivos | 1022 | 27310 | 10882 | 11645202 |
| proveedores | 1576 | 3430 | 1526 | 2073277 |
| chofer_estado_historial | 1815 | 52 | 43 | 15063 |
| domain_checks | 13860 | 14 | 4 | 11748 |

## Bloat: muertas > 20% de vivas (>1000 muertas)

_sin filas_


## FKs sin índice que las cubra

| tabla | conname | def |
|---|---|---|
| sgc.chofer_posiciones | chofer_posiciones_vehiculo_id_fkey | FOREIGN KEY (vehiculo_id) REFERENCES sgc.vehiculos(id) ON DELETE SET NULL |
| sgc.auditoria | auditoria_impersonado_por_fkey | FOREIGN KEY (impersonado_por) REFERENCES sgc.usuarios(id) ON DELETE SET NULL |
| sgc.rutas | rutas_creado_por_fkey | FOREIGN KEY (creado_por) REFERENCES sgc.usuarios(id) |
| sgc.rutas | rutas_conductor_id_fkey | FOREIGN KEY (conductor_id) REFERENCES sgc.conductores(id) |
| sgc.rutas | rutas_vehiculo_id_fkey | FOREIGN KEY (vehiculo_id) REFERENCES sgc.vehiculos(id) |
| sgc.app_error_reports | app_error_reports_user_id_fkey | FOREIGN KEY (user_id) REFERENCES sgc.usuarios(id) ON DELETE SET NULL |
| sgc.app_versiones | app_versiones_publicada_por_fkey | FOREIGN KEY (publicada_por) REFERENCES sgc.usuarios(id) |
| sgc.stock_apertura | stock_apertura_bodega_id_fkey | FOREIGN KEY (bodega_id) REFERENCES sgc.bodegas(id) ON DELETE CASCADE |
| sgc.registros_combustible | registros_combustible_proyecto_id_fkey | FOREIGN KEY (proyecto_id) REFERENCES sgc.proyectos(id) ON DELETE SET NULL |
| sgc.registros_combustible | registros_combustible_reenvio_de_fkey | FOREIGN KEY (reenvio_de) REFERENCES sgc.registros_combustible(id) |
| sgc.registros_combustible | registros_combustible_conductor_id_fkey | FOREIGN KEY (conductor_id) REFERENCES sgc.conductores(id) |
| sgc.registros_combustible | registros_combustible_registrado_por_fkey | FOREIGN KEY (registrado_por) REFERENCES sgc.usuarios(id) |
| sgc.registros_combustible | registros_combustible_factura_id_fkey | FOREIGN KEY (factura_id) REFERENCES sgc.combustible_facturas(id) ON DELETE SET NULL |
| sgc.registros_combustible | registros_combustible_permiso_id_fkey | FOREIGN KEY (permiso_id) REFERENCES sgc.combustible_permisos_retro(id) |
| sgc.registros_combustible | registros_combustible_revisada_por_fkey | FOREIGN KEY (revisada_por) REFERENCES sgc.usuarios(id) |
| sgc.proveedores | proveedores_ratificado_por_fkey | FOREIGN KEY (ratificado_por) REFERENCES sgc.usuarios(id) |
| sgc.conteo_items | conteo_items_articulo_id_fkey | FOREIGN KEY (articulo_id) REFERENCES sgc.articulos(id) |
| sgc.chofer_estado_historial | chofer_estado_historial_por_fkey | FOREIGN KEY (por) REFERENCES sgc.usuarios(id) |
| sgc.avisos_flota | avisos_flota_atendido_por_fkey | FOREIGN KEY (atendido_por) REFERENCES sgc.usuarios(id) |
| sgc.avisos_flota | avisos_flota_conductor_id_fkey | FOREIGN KEY (conductor_id) REFERENCES sgc.conductores(id) ON DELETE SET NULL |
| sgc.avisos_flota | avisos_flota_reportado_por_fkey | FOREIGN KEY (reportado_por) REFERENCES sgc.usuarios(id) ON DELETE SET NULL |
| sgc.incentivo_semana | incentivo_semana_conductor_id_fkey | FOREIGN KEY (conductor_id) REFERENCES sgc.conductores(id) |
| sgc.incentivo_semana | incentivo_semana_config_version_fkey | FOREIGN KEY (config_version) REFERENCES sgc.incentivo_config(version) |
| sgc.salida_firmas | salida_firmas_usuario_id_fkey | FOREIGN KEY (usuario_id) REFERENCES sgc.usuarios(id) |
| sgc.salidas_inventario | salidas_inventario_vehiculo_id_fkey | FOREIGN KEY (vehiculo_id) REFERENCES sgc.vehiculos(id) |
| sgc.salidas_inventario | salidas_inventario_despachante_usuario_id_fkey | FOREIGN KEY (despachante_usuario_id) REFERENCES sgc.usuarios(id) ON DELETE SET NULL |
| sgc.salidas_inventario | salidas_inventario_recibido_por_fkey | FOREIGN KEY (recibido_por) REFERENCES sgc.usuarios(id) |
| sgc.salidas_inventario | salidas_inventario_entregado_por_fkey | FOREIGN KEY (entregado_por) REFERENCES sgc.usuarios(id) |
| sgc.salidas_inventario | salidas_inventario_despachante_empleado_id_fkey | FOREIGN KEY (despachante_empleado_id) REFERENCES sgc.empleados(id) ON DELETE SET NULL |
| sgc.salidas_inventario | salidas_inventario_creado_por_fkey | FOREIGN KEY (creado_por) REFERENCES sgc.usuarios(id) |
| sgc.salidas_inventario | salidas_inventario_rechazada_por_fkey | FOREIGN KEY (rechazada_por) REFERENCES sgc.usuarios(id) |
| sgc.salidas_inventario | salidas_inventario_bodega_id_fkey | FOREIGN KEY (bodega_id) REFERENCES sgc.bodegas(id) |
| sgc.salidas_inventario | salidas_inventario_firma_pendiente_usuario_id_fkey | FOREIGN KEY (firma_pendiente_usuario_id) REFERENCES sgc.usuarios(id) |
| sgc.salidas_inventario | salidas_inventario_proyecto_id_fkey | FOREIGN KEY (proyecto_id) REFERENCES sgc.proyectos(id) |
| sgc.salidas_inventario | salidas_inventario_anulado_por_fkey | FOREIGN KEY (anulado_por) REFERENCES sgc.usuarios(id) |
| sgc.detalle_salidas | detalle_salidas_articulo_id_fkey | FOREIGN KEY (articulo_id) REFERENCES sgc.articulos(id) |
| sgc.bitacoras | bitacoras_weather_snapshot_id_fkey | FOREIGN KEY (weather_snapshot_id) REFERENCES sgc.weather_snapshots(id) |
| sgc.incentivo_incidencia_decision | incentivo_incidencia_decision_decidido_por_fkey | FOREIGN KEY (decidido_por) REFERENCES sgc.usuarios(id) |
| sgc.ruta_paradas | ruta_paradas_proyecto_id_fkey | FOREIGN KEY (proyecto_id) REFERENCES sgc.proyectos(id) ON DELETE SET NULL |
| sgc.vehiculos | vehiculos_km_base_combustible_por_fkey | FOREIGN KEY (km_base_combustible_por) REFERENCES sgc.usuarios(id) |

## Índices sin uso (idx_scan=0, no únicos/PK, >64kB)

| tabla | indice | tam | idx_scan |
|---|---|---|---|
| auditoria | ix_auditoria_registro_fecha | 5064 kB | 0 |
| auditoria | ix_auditoria_fecha | 1616 kB | 0 |
| auditoria | idx_auditoria_accion_creado | 1104 kB | 0 |
| domain_checks | idx_domain_checks_type | 872 kB | 0 |
| notas | ix_notas_dev_fts | 464 kB | 0 |
| articulos | idx_articulos_nombre_trgm | 192 kB | 0 |

## Índices duplicados (misma tabla, mismas columnas)

| tabla | indices | def |
|---|---|---|
| sgc.stock_por_bodega | {sgc.stock_por_bodega_pkey,sgc.stock_por_bodega_articulo_bodega_key} | CREATE UNIQUE INDEX stock_por_bodega_pkey ON sgc.stock_por_bodega USING btree (articulo_id, bodega_id) |
| sgc.vehiculo_entregas | {sgc.uq_entrega_recepcion_abierta,sgc.uq_ve_abierta} | CREATE UNIQUE INDEX uq_ve_abierta ON sgc.vehiculo_entregas USING btree (vehiculo_id) WHERE ((tipo = 'recepcion'::text) AND (estado = 'abierta'::text)) |
| sgc.auditoria | {sgc.idx_auditoria_actor_creado,sgc.ix_auditoria_actor_fecha} | CREATE INDEX idx_auditoria_actor_creado ON sgc.auditoria USING btree (actor_id, creado_en DESC) |
| sgc.fuel_prices | {sgc.fuel_prices_producto_vigencia_desde_key,sgc.idx_fuel_prices_producto_vig} | CREATE UNIQUE INDEX fuel_prices_producto_vigencia_desde_key ON sgc.fuel_prices USING btree (producto, vigencia_desde) |
| sgc.obra_avance_snapshots | {sgc.obra_avance_snapshots_proyecto_id_fecha_key,sgc.idx_avance_snap_proyecto} | CREATE UNIQUE INDEX obra_avance_snapshots_proyecto_id_fecha_key ON sgc.obra_avance_snapshots USING btree (proyecto_id, fecha) |
| sgc.incentivo_informe_version | {sgc.ix_incentivo_informe_version,sgc.incentivo_informe_version_anio_semana_version_key} | CREATE UNIQUE INDEX incentivo_informe_version_anio_semana_version_key ON sgc.incentivo_informe_version USING btree (anio, semana, version) |
| sgc.bitacora_orden_detalle | {sgc.bitacora_orden_detalle_bitacora_id_key,sgc.idx_orden_detalle_bitacora} | CREATE UNIQUE INDEX bitacora_orden_detalle_bitacora_id_key ON sgc.bitacora_orden_detalle USING btree (bitacora_id) |

## Tablas sin PK

_sin filas_


## Tablas SIN RLS activado

| relname | filas |
|---|---|
| proveedor_transporte_map | -1 |

## RLS con auth.uid()/auth.jwt() sin envolver en (select …) — initplan perdido

| tablename | policyname | cmd | expr |
|---|---|---|---|
| salida_firmas | salida_firmas_sel | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR (EXISTS ( SELECT 1 FROM sgc.salidas_inventario s WHERE ((s.id = salida_firma |
| geocode_cache | geocode_cache: read auth | SELECT | (auth.uid() IS NOT NULL)  |
| solicitud_material_items | solicitud_material_items: insert | INSERT |  (EXISTS ( SELECT 1 FROM sgc.solicitudes_material s WHERE ((s.id = solicitud_material_items.solicitud_id) AND (s.solicitante_id = auth. |
| solicitud_material_items | solicitud_material_items: select | SELECT | (EXISTS ( SELECT 1 FROM sgc.solicitudes_material s WHERE ((s.id = solicitud_material_items.solicitud_id) AND ((s.solicitante_id = auth. |
| solicitudes_material | solicitudes_material: insert | INSERT |  (solicitante_id = auth.uid()) |
| solicitudes_material | solicitudes_material: select | SELECT | ((solicitante_id = auth.uid()) OR sgc.puede_ver_todas_requisiciones())  |
| solicitudes_material | solicitudes_material: update | UPDATE | ((sgc.is_admin() OR sgc.tiene_modulo('inventario'::text)) AND (estado = 'pendiente'::text)) ((atendido_por = auth.uid()) AND (estado = ANY ( |
| salidas_inventario | salidas_inventario: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR ((proyecto_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM (sgc.proyecto_empleados |
| salidas_inventario | salidas_inventario: select conductor | SELECT | ((creado_por = auth.uid()) OR (EXISTS ( SELECT 1 FROM sgc.conductores c WHERE ((c.id = salidas_inventario.conductor_id) AND (c.usuario_ |
| documentos_proyecto | documentos_proyecto: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR (EXISTS ( SELECT 1 FROM (sgc.proyecto_empleados pe JOIN sgc.empleados e ON |
| proyecto_empleados | proyecto_empleados: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR sgc.tiene_modulo('rrhh'::text) OR (EXISTS ( SELECT 1 FROM sgc.empleados e WHE |
| bitacora_actividades | bitacora_actividades: insert | INSERT |  (EXISTS ( SELECT 1 FROM sgc.bitacoras b WHERE ((b.id = bitacora_actividades.bitacora_id) AND (b.usuario_id = auth.uid())))) |
| documentos_generados | documentos_generados: select | SELECT | (sgc.is_admin() OR (generado_por = auth.uid()) OR ((proyecto_id IS NULL) AND sgc.tiene_modulo('documentos'::text)) OR ((proyecto_id IS NOT N |
| fases_proyecto | fases_proyecto: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('proyectos'::text) OR (EXISTS ( SELECT 1 FROM (sgc.proyecto_empleados pe JOIN sgc.empleados e ON |
| stock_por_bodega | stock_por_bodega: referencia autenticados | SELECT | (auth.uid() IS NOT NULL)  |
| reportes_usuario | reportes_usuario: insert | INSERT |  (usuario_id = auth.uid()) |
| reportes_usuario | reportes_usuario: select | SELECT | ((usuario_id = auth.uid()) OR sgc.is_admin())  |
| importaciones_mapeo | importaciones_mapeo_rw | ALL | (usuario_id = auth.uid()) (usuario_id = auth.uid()) |
| bitacora_restricciones | bitacora_restricciones: insert | INSERT |  (EXISTS ( SELECT 1 FROM sgc.bitacoras b WHERE ((b.id = bitacora_restricciones.bitacora_id) AND (b.usuario_id = auth.uid())))) |
| rutas | rutas: select | SELECT | (sgc.es_flota_elevado() OR (creado_por = auth.uid()) OR (conductor_id IN ( SELECT sgc.mis_conductor_ids() AS mis_conductor_ids)))  |
| detalle_salidas | detalle_salidas: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('inventario'::text) OR (EXISTS ( SELECT 1 FROM ((sgc.salidas_inventario si JOIN sgc.proyecto_emp |
| detalle_salidas | detalle_salidas: select conductor | SELECT | (EXISTS ( SELECT 1 FROM (sgc.salidas_inventario si LEFT JOIN sgc.conductores c ON ((c.id = si.conductor_id))) WHERE ((si.id = deta |
| conductor_multas | cm_insert | INSERT |  (sgc.es_flota_elevado() OR (conductor_id IN ( SELECT conductores.id FROM sgc.conductores WHERE (conductores.usuario_id = auth.uid()))) |
| conductor_multas | cm_select | SELECT | (sgc.es_flota_elevado() OR (conductor_id IN ( SELECT conductores.id FROM sgc.conductores WHERE (conductores.usuario_id = auth.uid())))) |
| vehiculo_accidentes | va_insert | INSERT |  (sgc.es_flota_elevado() OR (creado_por = auth.uid())) |
| vehiculo_accidentes | va_select | SELECT | (sgc.es_flota_elevado() OR (conductor_id IN ( SELECT conductores.id FROM sgc.conductores WHERE (conductores.usuario_id = auth.uid())))) |
| vehiculo_danos | vd_insert | INSERT |  (sgc.es_flota_elevado() OR (reportado_por = auth.uid())) |
| vehiculo_danos | vd_select | SELECT | (sgc.es_flota_elevado() OR (reportado_por = auth.uid()))  |
| expediente_notas | expediente_notas: delete | DELETE | (sgc.is_admin() OR (usuario_id = auth.uid()))  |
| aprobaciones_legales | aprobaciones_legales: insert | INSERT |  (solicitado_por = auth.uid()) |
| aprobaciones_legales | aprobaciones_legales: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('legal'::text) OR (solicitado_por = auth.uid()))  |
| aprobaciones_legales | aprobaciones_legales: update | UPDATE | ((sgc.is_admin() OR sgc.tiene_modulo('legal'::text)) AND (estado = 'pendiente'::text)) ((revisado_por = auth.uid()) AND (estado = ANY (ARRAY |
| tarea_comentarios | tarea_comentarios: delete | DELETE | (sgc.is_admin() OR (usuario_id = auth.uid()))  |
| tarea_comentarios | tarea_comentarios: insert | INSERT |  ((usuario_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM sgc.tareas t WHERE ((t.id = tarea_comentarios.tarea_id) AND (sgc.is_admin() OR  |
| tarea_comentarios | tarea_comentarios: select | SELECT | (EXISTS ( SELECT 1 FROM sgc.tareas t WHERE ((t.id = tarea_comentarios.tarea_id) AND (sgc.is_admin() OR sgc.tiene_modulo('tareas'::text) |
| empleados | empleados: select | SELECT | ((usuario_id = auth.uid()) OR sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text))  |
| solicitudes_ausencia | solicitudes_ausencia: delete | DELETE | (sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR ((solicitado_por = auth.uid()) AND (estado = 'pendiente'::text)))  |
| solicitudes_ausencia | solicitudes_ausencia: insert | INSERT |  ((solicitado_por = auth.uid()) AND (sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR (EXISTS ( SELECT 1 FROM sgc.empleados e WHERE  |
| solicitudes_ausencia | solicitudes_ausencia: select | SELECT | (sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text) OR (solicitado_por = auth.uid()) OR (EXISTS ( SELECT 1 FROM sgc.empleados e WHERE ((e |
| solicitudes_ausencia | solicitudes_ausencia: update | UPDATE | ((sgc.is_admin() OR sgc.tiene_modulo('rrhh'::text)) AND (estado = 'pendiente'::text)) ((aprobado_por = auth.uid()) AND (estado = ANY (ARRAY[ |

## Tablas con más políticas RLS (multiple permissive = costo por fila)

| tablename | cmd | n |
|---|---|---|
| detalle_salidas | SELECT | 6 |
| salidas_inventario | SELECT | 6 |
| usuarios | SELECT | 5 |
| articulos | SELECT | 4 |

## Funciones más referenciadas en políticas RLS

| funcion | usos |
|---|---|
| is_admin | 435 |
| tiene_modulo | 400 |
| uid | 230 |
| submodulo_nivel_explicito | 88 |
| es_flota_elevado | 71 |
| es_tecnologia | 52 |
| es_revisor_tiendas | 51 |
| get_user_roles | 46 |
| puede_operar_submodulo | 43 |
| usuario_actual_es_prueba | 28 |
| puede_ver_submodulo | 26 |
| puede_ver_personal_obra | 10 |
| puede_gestionar_incentivos | 10 |
| puede_ver_reunion | 9 |
| puede_ver_bitacora | 8 |

## Top 20 consultas por tiempo total (pg_stat_statements)

_error: HTTP 400: {"message":"Failed to run sql query: ERROR:  42P01: relation \"pg_stat_statements\" does not exist\nLINE 3:   from pg_stat_statements s join pg_roles r on r.oid=s.userid order by total_exec_time desc limit 20\n               ^\n"}_


## Top 10 consultas por promedio (calls>20)

_error: HTTP 400: {"message":"Failed to run sql query: ERROR:  42P01: relation \"pg_stat_statements\" does not exist\nLINE 3:   from pg_stat_statements where calls>20 order by mean_exec_time desc limit 10\n               ^\n"}_


## Cache hit ratio

| tablas_pct | indices_pct |
|---|---|
| 100.00 | 100.00 |

## Conexiones por estado

| state | count | max_edad |
|---|---|---|
| active | 1 | -00:00:00.000001 |
| idle | 9 | 30 days 19:32:56.385512 |
| — | 1 | — |

## Cron jobs (pg_cron) y fallos recientes

| jobname | schedule | cmd | fallos_7d | seg_prom |
|---|---|---|---|---|
| sgc-requisiciones-vencidas | 15 11 * * * | select sgc.requisiciones_vencidas_avisar(); | 7 | 0.01 |
| sgc-vehiculos-sin-echada | 0 11 * * * | select sgc.avisar_vehiculos_sin_echada(); | 4 | 0.19 |
| sgc-consolidar-recorridos | 50 3 * * * | select sgc.consolidar_recorridos_del_dia(); | 0 | 5.60 |
| sgc-purgar-posiciones | 30 4 * * * | select sgc.purgar_posiciones_viejas(); | 0 | 1.30 |
| sgc-incentivo-semanal-lunes | 0 14 * * 1 | select sgc.incentivo_cron_lunes(); | 0 | 0.27 |
| sgc-recordar-firma-despachante | 0 */2 * * * | select sgc.recordar_conduces_por_firmar(); | 0 | 0.26 |
| sgc-incentivo-diario | 0 12 * * * | select sgc.incentivo_cron_diario(); | 0 | 0.23 |
| sgc-aplicar-vencimientos | 0 6 * * * | select sgc.aplicar_vencimientos_vehiculos(); | 0 | 0.23 |
| sgc-preaviso-reporte-semanal-sabado | 0 22 * * 6 | select sgc.recordatorio_reporte_semanal(false); | 0 | 0.21 |
| outbox-atascados-diario | 0 12 * * * | select sgc.outbox_atascados_resumen_diario(); | 0 | 0.20 |
| sgc-recordatorio-reporte-semanal-noche | 0 0 * * 1 | select sgc.recordatorio_reporte_semanal(true); | 0 | 0.18 |
| sgc-reporte-semanal-dia | 10 6 * * * | select sgc.sweep_avisos_reporte_semanal(); | 0 | 0.18 |
| sgc-placas-pp-sweep | 15 6 * * * | select sgc.evaluar_avisos_placas_pp(null); | 0 | 0.17 |
| sgc-cronograma-avisos | 15 6 * * * | select sgc.evaluar_avisos_cronograma(); | 0 | 0.16 |
| sgc-recordatorio-reporte-semanal-dia | */30 13-23 * * 0 | select sgc.recordatorio_reporte_semanal(true); | 0 | 0.16 |
| sgc-recordar-estados-chofer | 5 * * * * | select sgc.recordar_estados_chofer(); | 0 | 0.16 |
| sgc-cerrar-usos-huerfanos | 0 9 * * * |  select sgc.cerrar_usos_huerfanos(24);  | 0 | 0.14 |
| sgc-huecos-tracking | */5 * * * * | select sgc.detectar_huecos_tracking(); | 0 | 0.14 |
| sgc-obra-avance | 30 6 * * * | select sgc.evaluar_avance_obra(); | 0 | 0.13 |
| sgc-avisar-permisos-por-vencer | 30 7 * * * | select sgc.avisar_permisos_por_vencer(); | 0 | 0.13 |
| sgc-check-subscriptions | 0 */12 * * * | select net.http_post( url := '' \|\| sgc.edge_base_url() \|\| '/functions/v1/ch | 0 | 0.10 |
| weather-sync-obras | 0 */3 * * * | select net.http_post( url := '' \|\| sgc.edge_base_url() \|\| '/functions/v1/sync-we | 0 | 0.09 |
| sgc-resumen-operaciones-lunes | 0 11 * * 1 | select sgc.resumen_operaciones_cron_lunes(); | 0 | 0.09 |
| sgc-recordatorio-solicitudes-movimiento | 0 12 * * * | select sgc.recordatorio_solicitudes_movimiento(); | 0 | 0.08 |
| sgc-transcribe-audio | */10 * * * * | select net.http_post( url := '' \|\| sgc.edge_base_url() \|\| '/functions/v1/tr | 0 | 0.08 |
| sgc-recordar-firmas-pendientes | 0 13 * * * |  select sgc.recordar_firmas_pendientes();  | 0 | 0.08 |
| sgc-check-domains | 0 */2 * * * | select net.http_post( url := '' \|\| sgc.edge_base_url() \|\| '/functions/v1/ch | 0 | 0.08 |
| chequeo-semanal-almacenes | 0 6 * * 1 | select sgc.generar_tareas_chequeo_semanal(); | 0 | 0.08 |
| sgc-fuel-prices | 0 6 * * 6 | select net.http_post( url := '' \|\| sgc.edge_base_url() \|\| '/functions/v1/fu | 0 | 0.07 |
| sgc-echadas-por-aprobar | 30 11 * * * | select sgc.recordar_echadas_por_aprobar() | 0 | 0.06 |

## Triggers por tabla (>3 = escritura cara)

| relname | triggers |
|---|---|
| salidas_inventario | 13 |
| bodegas | 8 |
| registros_combustible | 7 |
| rutas | 7 |
| articulos | 6 |
| vehiculos | 5 |
| categorias_inventario | 5 |
| mantenimientos | 5 |
| proyectos | 5 |
| tec_equipos | 5 |
| conductores | 4 |
| proveedores | 4 |

## Columnas jsonb/text[] grandes sin GIN (candidatas)

| table_name | column_name | data_type |
|---|---|---|
| alerts | notified_channels | jsonb |
| app_error_reports | context | jsonb |
| app_versiones | cambios | jsonb |
| assistant_acciones | params | jsonb |
| assistant_idempotencia | resultado | jsonb |
| assistant_mensajes | herramientas | jsonb |
| audit_log | metadata | jsonb |
| auditoria | datos_despues | jsonb |
| auditoria | datos_antes | jsonb |
| auditoria | cambios | jsonb |
| avisos_flota | videos | ARRAY |
| avisos_flota | fotos | ARRAY |
| ayuda_contenido | contenido | jsonb |
| bitacora_danos | fotos_paths | ARRAY |
| bitacora_equipos_alquilados | fotos_paths | ARRAY |
| bitacora_molde_medidas | fotos_paths | ARRAY |
| bitacora_molde_medidas | medida_plano | jsonb |
| bitacora_molde_medidas | tramos | jsonb |
| bitacoras | migracion_obreros | jsonb |
| boveda_entradas | etiquetas | ARRAY |
| cartilla_piezas | tramos_cm | jsonb |
| charlas_seguridad | firmas | ARRAY |
| charlas_seguridad | fotos | ARRAY |
| checklists_vehiculo | datos | jsonb |
| claude_borradores | resultado | jsonb |
| claude_borradores | params | jsonb |
| claude_llamadas | params_resumen | jsonb |
| combustible_facturas | diagnostico | jsonb |
| conductores | tags | ARRAY |
| cronograma_recalculos | detalle | jsonb |
| documentos_generados | valores | jsonb |
| domain_checks | raw_response | jsonb |
| empresa | testigos_frecuentes | jsonb |
| entradas_inventario | items_propuestos | jsonb |
| flota_documentos_lecturas | resultado | jsonb |
| importaciones | errores | jsonb |
| importaciones_mapeo | mapeo | jsonb |
| incentivo_config | topes | jsonb |
| incentivo_config | pesos | jsonb |
| incentivo_dia | conteos | jsonb |