-- 2026-11-17 -- DS-29: en una bodega con fuente Odoo, el flujo normal (conduces, entradas, anulaciones) llama a sgc.adjust_stock y el
-- bloqueo tg_stock_por_bodega_fuente_odoo lo rechazaba: la bodega quedaba sin poder despachar. Ahora adjust_stock valida y aplica
-- el movimiento como proyeccion OPTIMISTA (el usuario ve el stock al instante); la proyeccion de Odoo (sondeo cada 5 min) manda y
-- corrige cualquier diferencia (p. ej. si la publicacion a Odoo fallo). Otros escritores directos siguen bloqueados.
create or replace function sgc.adjust_stock(p_articulo_id uuid, p_bodega_id uuid, p_delta numeric)
returns void
language plpgsql
as $function$
declare
  v_actual numeric;
  v_fuente boolean;
begin
  select cantidad into v_actual
  from sgc.stock_por_bodega
  where articulo_id = p_articulo_id and bodega_id = p_bodega_id
  for update;

  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo);
  if v_fuente then perform set_config('sgc.odoo_proyectando', 'true', true); end if;

  if not found then
    if p_delta < 0 then
      raise exception 'Stock insuficiente: no hay existencias registradas para este artículo en esta bodega.';
    end if;
    insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, p_delta, now());
  else
    if v_actual + p_delta < 0 then
      raise exception 'Stock insuficiente: disponible %, solicitado %.', v_actual, abs(p_delta);
    end if;
    update sgc.stock_por_bodega
    set cantidad = v_actual + p_delta, updated_at = now()
    where articulo_id = p_articulo_id and bodega_id = p_bodega_id;
  end if;

  if v_fuente then perform set_config('sgc.odoo_proyectando', 'false', true); end if;
end;
$function$;
