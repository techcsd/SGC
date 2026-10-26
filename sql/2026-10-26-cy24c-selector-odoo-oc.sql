-- CY24 Fase A (resto) -- selector de producto Odoo en "crear OC" (#24, D1/D6/D7).
--
-- D6 -- feature flag en SERVIDOR (no en el cliente). El alcance "por
-- proyecto/destino" que pide D6 queda ABIERTO (pregunta #1 de la issue sin
-- responder por Xaviel) -- esta pieza entrega el interruptor global más simple
-- posible: apagado = comportamiento idéntico a hoy (criterio de aceptación 1),
-- encendido = el selector de líneas de OC pasa a buscar en Odoo. Subir a
-- "por proyecto" es un cambio aditivo cuando haya respuesta.
--
-- D7 -- NO se toca la firma ni el INSERT de crear_orden_compra (14 args, ya
-- vigente). Las columnas odoo_product_id/odoo_uom_id/odoo_snapshot de
-- orden_compra_items (ya existen, F10 Fase A) se escriben DESPUÉS de crear el
-- renglón, con una RPC nueva y restringida -- mismo patrón que
-- registrar_publicacion_oc (que tampoco toca crear_orden_compra).
begin;
set local lock_timeout = '3s';
set local statement_timeout = '90s';

insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_compras_piloto_habilitado', 'false',
   'CY24 (#24) -- enciende el selector de producto Odoo en Compras > Órdenes de compra. Apagado por defecto: el flujo sigue siendo el catálogo SGC (criterio de aceptación 1). Alcance hoy es global, no por proyecto/destino (pregunta #1 de la issue sin responder).')
on conflict (clave) do nothing;

create or replace function sgc.odoo_compras_piloto_habilitado()
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(
    (select lower(p.valor) = 'true' from sgc.parametros p
      where p.clave = 'odoo_compras_piloto_habilitado'),
    false);
$$;
grant execute on function sgc.odoo_compras_piloto_habilitado() to authenticated, service_role;

-- D7 -- escribe la identidad Odoo de UN renglón ya creado. AT11: p_odoo_snapshot
-- completo (lo que devolvió productos.buscar_compra) queda guardado, no solo el id.
create or replace function sgc.vincular_item_producto_odoo(
  p_item_id uuid, p_odoo_product_id bigint, p_odoo_uom_id bigint default null, p_odoo_snapshot jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras') or auth.role() = 'service_role') then
    raise exception 'Solo Compras puede vincular un renglón a un producto de Odoo' using errcode = '42501';
  end if;
  if p_odoo_product_id is null or p_odoo_product_id <= 0 then
    raise exception 'p_odoo_product_id inválido';
  end if;

  update sgc.orden_compra_items
     set odoo_product_id = p_odoo_product_id,
         odoo_uom_id = p_odoo_uom_id,
         odoo_snapshot = p_odoo_snapshot
   where id = p_item_id;

  return found;
end;
$fn$;
comment on function sgc.vincular_item_producto_odoo is 'SGC Odoo foundation v1 (CY24 #24, D7) -- escribe la identidad Odoo de un renglón ya creado, sin tocar crear_orden_compra.';
revoke all on function sgc.vincular_item_producto_odoo(uuid, bigint, bigint, jsonb) from public, anon;
grant execute on function sgc.vincular_item_producto_odoo(uuid, bigint, bigint, jsonb) to authenticated, service_role;

commit;
