-- Reversa de sql/2026-11-25-odoo-fusionar-ties-80.sql: desvincula CSD-03-028 y le devuelve su nombre.
-- (El artículo ODOO-1221 eliminado era un duplicado sin uso; el sondeo de Odoo lo vuelve a importar si hace falta.)
begin;
select set_config('sgc.odoo_importando', 'true', true);
update sgc.articulos set odoo_product_id = null, odoo_template_id = null, odoo_instancia_id = null, nombre = 'TIES 80CM'
 where codigo = 'CSD-03-028' and odoo_product_id = 1221;
commit;
