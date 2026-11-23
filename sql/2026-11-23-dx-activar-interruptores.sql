-- DX (23-nov-2026) -- Xaviel pidió encender los interruptores de la ronda: herramientas Odoo de solo lectura para Compa/MCP,
-- QR de requisición y QR de solicitud de compra. Reversa: sql/_reversa/2026-11-23-dx-activar-interruptores.reversa.sql
begin;
update sgc.parametros set valor = 'true', updated_at = now()
 where clave in ('odoo_herramientas_ia', 'doc_qr_requisicion_activo', 'doc_qr_solicitud_compra_activo');
commit;
