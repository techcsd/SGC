-- HOTFIX Odoo 19 (25-nov-2026) -- Desactiva la «apertura automática» de artículos nuevos (AU6, parámetro
-- apertura_nuevos_articulos = 1000 unidades por almacén). Era el stock sintético de los primeros tiempos de SGC;
-- ahora Odoo es la fuente de verdad del inventario. Autorizado por Xaviel el 25-nov-2026. 0 = desactivada
-- (tg_articulo_apertura_automatica ya respeta 0). Reversa: sql/_reversa/2026-11-25-desactivar-apertura-nuevos-articulos.reversa.sql
begin;
set local lock_timeout = '3s';
update sgc.parametros set valor = '0', updated_at = now() where clave = 'apertura_nuevos_articulos';
commit;
