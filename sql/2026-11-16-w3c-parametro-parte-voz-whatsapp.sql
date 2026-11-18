-- W3 (DS-41 / #76, ronda DS 16-nov-2026): interruptor del parte diario por voz/WhatsApp. ADITIVA, APAGADO por defecto.
-- Con 'true', Compa (WhatsApp/voz) ofrece la herramienta preparar_parte_diario: arma una PROPUESTA con la edge bitacora-ia
-- (con la sesion del usuario, su consentimiento de IA y sus limites) y manda un enlace para revisarla; nunca crea la bitacora.
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('parte_voz_whatsapp_activo', 'false', 'DS-41 #76: true = Compa puede armar un borrador de parte diario desde una nota de voz/texto y enviar el enlace de revision. Apagado por defecto.')
on conflict (clave) do nothing;
commit;
