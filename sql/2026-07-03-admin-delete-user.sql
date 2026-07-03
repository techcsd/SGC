-- Hard-delete for users with genuinely no associated data (e.g. a test
-- invite created by mistake), on top of the existing soft-deactivate.
--
-- sgc.audit_log referenced sgc.usuarios with the default ON DELETE NO
-- ACTION — meaning every user, even one deleted seconds after creation,
-- already has a permanent "usuario_creado" audit row blocking any future
-- hard delete forever. Audit logs should outlive the thing they're about
-- (that's the point of an audit trail), so this switches both FKs to ON
-- DELETE SET NULL — the row (and its metadata: email/nombre/etc., already
-- stored as jsonb) survives; only the now-dangling user reference clears.
--
-- Every OTHER FK into sgc.usuarios (bitacoras.usuario_id,
-- empleados.usuario_id, documentos_generados.generado_por,
-- proyectos.responsable_id, solicitudes_material.solicitante_id, etc.)
-- stays ON DELETE NO ACTION deliberately — those represent real business
-- data that must never be silently orphaned or cascaded away. Postgres
-- itself blocks the delete with a clear foreign-key-violation the moment
-- any of those exist, which is exactly the desired "can't delete a user
-- with real activity — deactivate instead" behavior, enforced at the DB
-- level with no need to replicate the check in application code.
alter table sgc.audit_log drop constraint audit_log_actor_id_fkey;
alter table sgc.audit_log add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references sgc.usuarios(id) on delete set null;

alter table sgc.audit_log drop constraint audit_log_target_user_id_fkey;
alter table sgc.audit_log add constraint audit_log_target_user_id_fkey
  foreign key (target_user_id) references sgc.usuarios(id) on delete set null;
