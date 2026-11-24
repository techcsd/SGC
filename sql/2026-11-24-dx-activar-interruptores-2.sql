-- DX (24-nov-2026) -- Xaviel: «enciende todos esos interruptores, debe quedar funcionando todo».
-- Deja en 'true' todos los interruptores de la ronda DX. Idempotente. Reversa: sql/_reversa/2026-11-24-dx-activar-interruptores-2.reversa.sql
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_herramientas_ia', 'true', 'DX12 — herramientas Odoo de solo lectura para Compa/MCP.'),
  ('doc_qr_requisicion_activo', 'true', 'DX7 — QR de requisición.'),
  ('doc_qr_solicitud_compra_activo', 'true', 'DX7 — QR de solicitud de compra.'),
  ('doc_qr_conduce_externo_activo', 'true', 'DX7 — QR de la ficha del conduce externo.')
on conflict (clave) do update set valor = 'true', updated_at = now();
update sgc.parametros set valor = 'true', updated_at = now() where clave = 'conduce_qr_activo';
commit;
