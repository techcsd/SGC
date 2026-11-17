-- 2026-11-17 -- Triage de issues abiertos: enciende los interruptores ya construidos y activa la retencion.
--   #56  SLA de 48 h de solicitudes de material con escalamiento (sla_solicitud_material_activo)
--   #58  aviso diario de conduces despachados sin cerrar (conduce_aviso_activo)
--   #82  resumen diario de tareas por aviso en app y push (tareas_resumen_diario_activo)
--   #72  retencion: auditoria 365 d (archiva a auditoria_archivo, no borra), notif_entregas 30 d, weather_snapshots 30 d, app_error_reports 60 d
-- NO se enciende: conduce_qr_activo (sin probar en vivo), proveedores_selector_restringido (0 de 1577 ratificados dejaria el selector vacio),
-- realtime_podar_activo (hay que confirmar antes que csd-app no use las tablas sobrantes).
-- Apagar: update sgc.parametros set valor='false' (o '0' en retencion) where clave = ... (reversible, sin cambio de esquema).
update sgc.parametros set valor = 'true', updated_at = now() where clave in ('sla_solicitud_material_activo', 'conduce_aviso_activo', 'tareas_resumen_diario_activo');
update sgc.parametros set valor = '365', updated_at = now() where clave = 'retencion_auditoria_dias';
update sgc.parametros set valor = '30', updated_at = now() where clave in ('retencion_notif_entregas_dias', 'retencion_weather_snapshots_dias');
update sgc.parametros set valor = '60', updated_at = now() where clave = 'retencion_app_error_reports_dias';
