-- Fix: grant execute ... to service_role faltaba en 3 funciones de esta
-- misma ronda (cy19-homologacion-vincular.sql, cy6-outbox-odoo.sql x2).
-- service_role es un rol de Postgres DISTINTO de authenticated -- otorgar a
-- uno no cubre al otro. Encontrado al probar odoo-sync (edge con service
-- role key) contra odoo_v1_reclamar_eventos: "permission denied for
-- function" via PostgREST aunque is_admin()/auth.role()='service_role'
-- estaba bien en el cuerpo -- el GRANT bloqueaba antes de llegar ahi.
-- Migracion nueva en vez de reescribir las ya pusheadas a dev (CD10).
begin;

grant execute on function sgc.odoo_homologacion_vincular(jsonb, boolean) to service_role;
grant execute on function sgc.odoo_v1_reclamar_eventos(uuid, text, integer, integer) to service_role;
grant execute on function sgc.odoo_v1_finalizar_evento(uuid, uuid, text, jsonb, text, timestamptz) to service_role;

commit;
