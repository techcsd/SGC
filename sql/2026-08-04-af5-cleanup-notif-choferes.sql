-- AF5 (limpieza) — Elimina las notificaciones de BROADCAST viejas que el fan-out
-- de notificar_modulo dejó en la bandeja de los choferes ANTES del fix
-- (2026-08-04-af5-notif-chofer-scope). Solo títulos de broadcast de supervisión
-- inequívocos, y solo para usuarios cuyos roles son TODOS operativos (choferes
-- puros) — así no se toca nada per-usuario ni a usuarios de oficina.
-- Idempotente (si no hay filas, no borra nada).

delete from sgc.notificaciones n
where n.titulo in (
    'Consumo anormal de combustible',
    'Pre-uso con hallazgos',
    'Vehículo bloqueado en pre-uso',
    'Mantenimiento vencido',
    'Agendar pre-cita de mantenimiento',
    'Compra de ferretería por confirmar'
  )
  and exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = n.usuario_id and coalesce(r.es_operativo, false)
  )
  and not exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = n.usuario_id and not coalesce(r.es_operativo, false)
  );
