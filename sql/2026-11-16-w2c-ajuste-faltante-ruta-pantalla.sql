-- W2c: la notificación de faltante apunta a la pantalla real (Inventario › Faltantes y corte con Odoo). Solo cambia la ruta de _odoo_ajuste_crear.
create or replace function sgc._odoo_ajuste_crear(p_salida uuid)
returns integer language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_n integer;
begin
  insert into sgc.odoo_solicitudes_ajuste (salida_id, articulo_id, faltante)
  select d.salida_id, d.articulo_id, d.cantidad - d.cantidad_recibida
    from sgc.detalle_salidas d join sgc.salidas_inventario s on s.id = d.salida_id
   where d.salida_id = p_salida and s.estado = 'entregado_incompleto' and coalesce(s.es_prueba, false) = false
     and d.cantidad_recibida is not null and d.cantidad_recibida < d.cantidad
  on conflict (salida_id, articulo_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform sgc.notificar_modulo('inventario', 'alerta', 'Faltante por resolver', 'Un conduce llegó incompleto: aprueba el ajuste o devuelve el material desde tránsito.', '/inventario/ajustes-odoo');
  end if;
  return v_n;
end $fn$;
revoke all on function sgc._odoo_ajuste_crear(uuid) from public, anon, authenticated;
