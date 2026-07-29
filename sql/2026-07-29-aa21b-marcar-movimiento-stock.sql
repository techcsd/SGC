-- PROMPT-9 · FASE 5 — AA21b: marcar/desmarcar un movimiento de inventario como
-- prueba AJUSTANDO el stock (revierte al marcar test, re-aplica al volver a real).
-- Corrige el hueco de marcar un movimiento REAL existente como prueba (su stock
-- quedaba aplicado) y habilita el "crear como prueba" consistente. Solo admin.
create or replace function sgc.marcar_movimiento_inventario_prueba(p_tabla text, p_id uuid, p_valor boolean)
returns void language plpgsql security definer set search_path = sgc, public as $$
declare v_bodega uuid; v_actual boolean; r record;
begin
  if not sgc.is_admin() then raise exception 'Solo un admin puede marcar datos de prueba' using errcode = '42501'; end if;
  if p_tabla = 'entradas_inventario' then
    select bodega_id, coalesce(es_prueba,false) into v_bodega, v_actual from sgc.entradas_inventario where id = p_id;
    if v_bodega is null then raise exception 'Entrada no encontrada'; end if;
    if v_actual = p_valor then return; end if;
    for r in select articulo_id, cantidad from sgc.detalle_entradas where entrada_id = p_id loop
      perform sgc.adjust_stock(r.articulo_id, v_bodega, case when p_valor then -r.cantidad else r.cantidad end);
    end loop;
    update sgc.entradas_inventario set es_prueba = p_valor, es_prueba_origen = case when p_valor then 'manual' else null end where id = p_id;
  elsif p_tabla = 'salidas_inventario' then
    select bodega_id, coalesce(es_prueba,false) into v_bodega, v_actual from sgc.salidas_inventario where id = p_id;
    if v_bodega is null then raise exception 'Salida no encontrada'; end if;
    if v_actual = p_valor then return; end if;
    for r in select articulo_id, cantidad from sgc.detalle_salidas where salida_id = p_id loop
      perform sgc.adjust_stock(r.articulo_id, v_bodega, case when p_valor then r.cantidad else -r.cantidad end);
    end loop;
    update sgc.salidas_inventario set es_prueba = p_valor, es_prueba_origen = case when p_valor then 'manual' else null end where id = p_id;
  else
    raise exception 'Tabla no soportada' using errcode = '22023';
  end if;
end $$;
grant execute on function sgc.marcar_movimiento_inventario_prueba(text, uuid, boolean) to authenticated, service_role;
select 'ok';
