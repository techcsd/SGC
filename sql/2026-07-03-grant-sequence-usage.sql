-- Fixes "permission denied for sequence roles_id_seq" when creating a
-- role from Admin > Roles.
--
-- Sequence privileges are a separate grant layer from table privileges in
-- Postgres — GRANT INSERT ON a table is not enough if the column's
-- default calls nextval() on a sequence; the role also needs USAGE (and
-- ideally SELECT, for currval()/lastval()) on that sequence specifically.
-- `authenticated` had table-level INSERT on sgc.roles (added when Roles
-- CRUD was built) but nobody had ever granted it sequence access, since
-- every other write path in this schema either uses a uuid primary key
-- (gen_random_uuid(), no sequence involved) or a SECURITY DEFINER
-- function that runs as its owner.
--
-- Checking ALL sequences in the schema surfaced a second, more serious,
-- previously-undiscovered instance of the same bug: sgc.crear_orden_compra()
-- calls nextval('sgc.ordenes_compra_numero_seq') and is SECURITY INVOKER
-- (not DEFINER) — meaning creating a real purchase order (Compras >
-- Órdenes de Compra, and the aprobar_solicitud_compra flow that calls it
-- internally) has been completely broken for any real authenticated
-- session this whole time. Verified directly: a simulated authenticated
-- call to crear_orden_compra failed with the identical
-- "permission denied for sequence ordenes_compra_numero_seq" error before
-- this fix, and succeeded after.
grant usage, select on sequence sgc.roles_id_seq to authenticated;
grant usage, select on sequence sgc.categorias_inventario_id_seq to authenticated;
grant usage, select on sequence sgc.ordenes_compra_numero_seq to authenticated;

-- So this doesn't recur for any future serial/identity column added to sgc.
alter default privileges in schema sgc grant usage, select on sequences to authenticated;
