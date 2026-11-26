-- HOTFIX (26-nov-2026) -- sql/2026-11-25-odoo-alinear-catalogo.sql dejó tg_homologar_nombre() leyendo new.odoo_product_id,
-- pero el trigger también cuelga de bodegas, categorias_inventario y proyecto_partidas, que NO tienen esa columna:
-- insertar/editar en ellas fallaba con «record "new" has no field "odoo_product_id"». Se lee la columna por jsonb
-- (null si no existe) y el comportamiento para sgc.articulos queda igual.
-- Reversa: sql/_reversa/2026-11-26-odoo-homologar-nombre-sin-columna.reversa.sql
begin;
set local lock_timeout = '3s';

create or replace function sgc.tg_homologar_nombre()
returns trigger
language plpgsql
as $function$
begin
  if to_jsonb(new) ->> 'odoo_product_id' is not null then
    -- Odoo manda: nombre exacto de Odoo (solo espacios recortados/colapsados).
    new.nombre := nullif(btrim(regexp_replace(coalesce(new.nombre, ''), '\s+', ' ', 'g')), '');
  else
    new.nombre := sgc.homologar_texto(new.nombre);
  end if;
  return new;
end;
$function$;

commit;
