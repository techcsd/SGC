-- CE15 — Saneamiento revienta con `column "m" does not exist` (Raykler y admin)
-- ---------------------------------------------------------------------------------
-- Causa exacta (prod == repo, verificada con pg_get_functiondef): dentro de
--   echadas_sospechosas() el subselect de motivos hace
--     (select array_agg(m) from unnest(array_remove(array[...], null)))
--   pero `unnest(...)` NO está aliasado como `m`, así que `array_agg(m)` referencia
--   una columna inexistente → 42703 "column m does not exist" en tiempo de ejecución.
--   (El comentario de BQ3 decía "corre limpio 22 filas"; en algún punto se re-creó sin
--   el alias — regla 19 lo detecta: prod==repo, ambos rotos.)
-- Arreglo: aliasar la relación de unnest como `m`.  Copia viva + ese único cambio.
-- Gate y cuerpo idénticos a BQ5 (es_flota_elevado → incluye a Raykler/logística).
-- ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sgc.echadas_sospechosas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_pmin numeric := coalesce((select valor from sgc.flota_config where clave='precio_gal_min'), 100);
  v_pmax numeric := coalesce((select valor from sgc.flota_config where clave='precio_gal_max'), 600);
  v_rmin numeric := coalesce((select valor from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
  v_rmax numeric := coalesce((select valor from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
  v_capnv numeric := coalesce((select valor from sgc.flota_config where clave='tanque_cap_no_vehiculo'), 500);
begin
  -- BQ5 — antes is_admin(); ahora el mismo predicado que registrar_combustible_app.
  if not sgc.es_flota_elevado() then raise exception 'Solo referentes de flota' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.fecha desc)
    from (
      select r.id, r.fecha, r.vehiculo_id, v.placa, v.marca, v.tipo,
             r.galones, r.monto, r.precio_por_galon, r.kilometraje, r.km_recorridos,
             r.rendimiento_km_gal, r.estado, r.es_prueba, r.invalidada,
             case when r.vehiculo_id is not null then sgc.cap_tanque_vehiculo(r.vehiculo_id) else v_capnv end as cap,
             -- CE15 — `unnest(...) m` : sin el alias `m`, array_agg(m) daba 42703.
             (select array_agg(m) from unnest(array_remove(array[
                case when r.vehiculo_id is not null and r.galones > sgc.cap_tanque_vehiculo(r.vehiculo_id)
                     then 'Galones sobre la capacidad de tanque' end,
                case when r.vehiculo_id is null and r.galones > v_capnv
                     then 'Galones sobre el tope de depósito' end,
                case when coalesce(r.monto,0) > 0 and r.precio_por_galon is not null
                          and (r.precio_por_galon < v_pmin or r.precio_por_galon > v_pmax)
                     then 'Precio/galón fuera de banda' end,
                case when r.rendimiento_km_gal is not null and r.rendimiento_km_gal > v_rmax
                     then 'Rendimiento imposiblemente alto (error de dato)' end,
                case when r.rendimiento_km_gal is not null and r.km_recorridos is not null
                          and r.rendimiento_km_gal < v_rmin
                     then 'Rendimiento imposiblemente bajo' end
              ], null)) m ) as motivos
      from sgc.registros_combustible r
      left join sgc.vehiculos v on v.id = r.vehiculo_id
      where not coalesce(r.invalidada, false)
        and (
          (r.vehiculo_id is not null and r.galones > sgc.cap_tanque_vehiculo(r.vehiculo_id)) or
          (r.vehiculo_id is null and r.galones > v_capnv) or
          (coalesce(r.monto,0) > 0 and r.precio_por_galon is not null
             and (r.precio_por_galon < v_pmin or r.precio_por_galon > v_pmax)) or
          (r.rendimiento_km_gal is not null and r.rendimiento_km_gal > v_rmax) or
          (r.rendimiento_km_gal is not null and r.km_recorridos is not null and r.rendimiento_km_gal < v_rmin)
        )
    ) x
  ), '[]'::jsonb);
end;
$function$;
grant execute on function sgc.echadas_sospechosas() to authenticated;
