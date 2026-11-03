-- DH8 — los correos de requisición (notificar-solicitud) usaban tipos
-- ('solicitud_material','solicitud_compra','solicitud_resuelta') que NUNCA
-- existieron en sgc.notif_tipo (el propio código lo admitía: "No hay un
-- notif_tipo registrado para solicitudes"). puede_silenciar_notif() cae a
-- `true` para un tipo desconocido, pero la pantalla de Configuración lista
-- los TOGGLES a partir de las filas de notif_tipo — sin fila, no hay forma
-- de apagarlos (el caso de Sonia). Sembrando las filas, el apagador aparece
-- solo (ajustes-notificaciones ya itera notif_tipo).

insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values
  ('solicitud_material', 'Requisiciones de materiales',
   'Correo cuando se crea o se resuelve una requisición de materiales.', false, array['email'], true, 70),
  ('solicitud_compra', 'Solicitudes de compra',
   'Correo cuando se crea una solicitud de compra.', false, array['email'], true, 71)
on conflict (tipo) do nothing;
