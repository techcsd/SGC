-- 2026-11-17 -- #76: se enciende el parte diario por voz/WhatsApp. Probado en dev con usuario QA: Compa llamo preparar_parte_diario,
-- guardo una PROPUESTA con enlace de revision y NO creo ninguna bitacora (0 filas). Requiere modulo bitacora y consentimiento de IA.
-- Apagar: valor 'false'.
update sgc.parametros set valor = 'true', updated_at = now() where clave = 'parte_voz_whatsapp_activo';
