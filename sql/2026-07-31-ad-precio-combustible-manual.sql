-- ============================================================================
-- Precio de combustible: override MANUAL por admin — 31/07/2026
-- ----------------------------------------------------------------------------
-- El fetch automático del MICM funciona, pero la fuente oficial publica con
-- rezago (a veces semanas). Para que la web muestre SIEMPRE el precio real,
-- un admin/flota puede fijar el precio vigente a mano. `precios_combustible_vigentes`
-- toma el de mayor `vigencia_desde`, así el override manual (fecha de hoy) manda.
-- ============================================================================

create or replace function sgc.set_precio_combustible(
  p_producto text,
  p_precio numeric,
  p_vigencia_desde date default current_date
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No tienes permiso para cambiar los precios de combustible';
  end if;
  if p_producto not in ('gasolina_regular','gasolina_premium','diesel_regular','diesel_premium') then
    raise exception 'Producto inválido: %', p_producto;
  end if;
  if coalesce(p_precio, 0) <= 0 then
    raise exception 'El precio debe ser mayor que 0';
  end if;

  insert into sgc.fuel_prices (producto, precio, vigencia_desde, vigencia_hasta, fuente)
  values (p_producto, p_precio, coalesce(p_vigencia_desde, current_date), null, 'Manual')
  on conflict (producto, vigencia_desde)
  do update set precio = excluded.precio, fuente = 'Manual', vigencia_hasta = null;
end;
$$;

grant execute on function sgc.set_precio_combustible(text, numeric, date) to authenticated;
