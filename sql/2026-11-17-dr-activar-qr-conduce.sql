-- 2026-11-17 -- #74: se enciende el QR del conduce. Probado de punta a punta en dev (emitir -> resolver 200 con estado; token alterado -> 400 token_firma);
-- el secret CONDUCE_QR_SECRET existe en dev y prod y la edge conduce-qr esta desplegada en ambos. Apagar: valor 'false'.
update sgc.parametros set valor = 'true', updated_at = now() where clave = 'conduce_qr_activo';
