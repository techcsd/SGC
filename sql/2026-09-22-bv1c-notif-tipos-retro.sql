-- BV1 (notif) — registra los tipos de notificación de la echada retroactiva. Sin estas
-- filas, sgc.notificar(...) descarta silenciosamente el aviso (por eso el otorgar no
-- notificaba). combustible_retro_permitida → al chofer; combustible_retro_usada → a flota.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-22-bv1c-notif-tipos-retro.sql --env dev  →  --env prod
begin;

insert into sgc.notif_tipo (tipo, etiqueta, descripcion, es_operativa, canales, activo, orden)
values
  ('combustible_retro_permitida', 'Permiso de echada retroactiva',
   'Se te autorizó registrar echadas de combustible con fecha pasada.', false,
   array['in_app','push']::text[], true, 62),
  ('combustible_retro_usada', 'Echada retroactiva registrada',
   'Un usuario registró una echada de combustible con fecha pasada.', false,
   array['email','in_app','push']::text[], true, 63)
on conflict (tipo) do nothing;

commit;
