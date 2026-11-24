update sgc.parametros set valor = 'false', updated_at = now()
 where clave in ('odoo_herramientas_ia','doc_qr_requisicion_activo','doc_qr_solicitud_compra_activo','doc_qr_conduce_externo_activo');
