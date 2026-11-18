-- 2026-11-17 -- #68: poda de la publicacion de Realtime. Confirmado en el codigo de web (src/) y de la app (csd-app, origin/main) que ninguna suscribe
-- avisos_flota, vehiculo_asignaciones, proyecto_partidas, avisos_proyecto, vehiculo_accidentes, vehiculo_danos ni conductor_multas (la app solo
-- suscribe agente_eventos, chofer_ultima_posicion, mensajes y notificaciones, que la web tambien usa y se conservan).
-- Reversible: select sgc.realtime_restaurar_publicacion(); o poner realtime_podar_activo = 'false'.
update sgc.parametros set valor = 'true', updated_at = now() where clave = 'realtime_podar_activo';
select * from sgc.realtime_sincronizar_publicacion(true);
