-- DS-41 (#64) correccion de KPIs/badges que sumaban datos es_prueba (hallados por scripts/audit-kpis-es-prueba.mjs).
create or replace function sgc.requisiciones_bandeja_count()
 returns integer
 language sql stable security definer
 set search_path to 'sgc', 'pg_temp'
as $$
  select case when sgc.puede_ver_todas_requisiciones()
    then (select count(*)::int from sgc.solicitudes_material where estado = 'pendiente' and not coalesce(es_prueba,false))
    else 0 end;
$$;

create or replace function sgc.productos_por_dar_de_alta_count()
 returns integer
 language sql stable
 set search_path to 'sgc', 'pg_temp'
as $$
  select count(*)::integer from sgc.odoo_producto_solicitudes where estado = 'pendiente' and not coalesce(es_prueba,false);
$$;

create or replace function sgc.tarjeta_consumo_periodo(p_codigo_tarjeta text, p_fecha date default current_date)
 returns table(periodo text, galones numeric, monto numeric, cupo_gal numeric, cupo_monto numeric, pct_gal numeric, pct_monto numeric)
 language plpgsql stable security definer
 set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_cupo_gal   numeric;
  v_cupo_monto numeric;
  v_dia_corte  smallint;
  v_desde      date;
  v_hasta      date;
  v_etiqueta   text;
  v_gal        numeric;
  v_monto      numeric;
begin
  select m.cupo_gal, m.cupo_monto, m.cupo_dia_corte into v_cupo_gal, v_cupo_monto, v_dia_corte
    from sgc.combustible_tarjeta_map m where m.codigo_tarjeta = p_codigo_tarjeta;

  select r.desde, r.hasta, r.etiqueta into v_desde, v_hasta, v_etiqueta
    from sgc.tarjeta_periodo_rango(v_dia_corte, p_fecha) r;

  select coalesce(sum(rc.galones), 0), coalesce(sum(rc.monto), 0) into v_gal, v_monto
    from sgc.registros_combustible rc
   where rc.tarjeta = p_codigo_tarjeta
     and rc.fecha between v_desde and v_hasta
     and not coalesce(rc.invalidada, false)
     and not coalesce(rc.es_prueba, false);

  periodo := v_etiqueta; galones := v_gal; monto := v_monto;
  cupo_gal := v_cupo_gal; cupo_monto := v_cupo_monto;
  pct_gal := case when v_cupo_gal is not null and v_cupo_gal > 0 then round(v_gal / v_cupo_gal * 100, 1) else null end;
  pct_monto := case when v_cupo_monto is not null and v_cupo_monto > 0 then round(v_monto / v_cupo_monto * 100, 1) else null end;
  return next;
end;
$$;
