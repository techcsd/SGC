-- BL7 — Resumen semanal §6: el rendimiento km/gal ya existe (por echada), pero el
-- informe hacía sum(km)/sum(gal) sobre un delta de odómetro → una echada saltada
-- inflaba el número (L473027 = 68.9 km/gal, el doble del techo 35). Aquí la RPC
-- pasa a exponer, por vehículo:
--   • rendimiento (promedio de la semana de las echadas PLAUSIBLES; null si ninguna)
--   • rendimiento_estimado (cascada T5: esperado del vehículo → su promedio histórico
--     con ≥min_registros → promedio de flota)
-- con los filtros de plausibilidad del propio sistema (flota_config). Los galones,
-- el costo y km se conservan (los galones ya estaban bien). Aditivo: sólo agrega
-- campos al JSON; el edge (§6) los formatea en es-DO.

begin;

create or replace function sgc.resumen_flota_carga_semana(p_anio integer default null, p_semana integer default null)
returns jsonb language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_ref  date := (now() at time zone 'America/Santo_Domingo')::date - 7;
  v_anio int := coalesce(p_anio, extract(isoyear from v_ref)::int);
  v_sem  int := coalesce(p_semana, extract(week from v_ref)::int);
  v_ini  date; v_fin date;
  v_min    numeric := coalesce((select valor::numeric from sgc.flota_config where clave='rendimiento_minimo_km_gal'), 10);
  v_max    numeric := coalesce((select valor::numeric from sgc.flota_config where clave='rendimiento_maximo_km_gal'), 35);
  v_minreg int     := coalesce((select valor::int     from sgc.flota_config where clave='min_registros_baseline'), 3);
  v_distmin numeric:= coalesce((select valor::numeric from sgc.flota_config where clave='dist_min_km'), 50);
  v_flota_avg numeric;
begin
  select inicio, fin into v_ini, v_fin from sgc.semana_rango(v_anio, v_sem);

  -- Promedio de flota (histórico, echadas plausibles) — último escalón de la cascada.
  select round(avg(rc.rendimiento_km_gal), 1) into v_flota_avg
  from sgc.registros_combustible rc
  join sgc.vehiculos v on v.id = rc.vehiculo_id
  where not coalesce(rc.invalidada, false) and not coalesce(rc.es_prueba, false)
    and rc.rendimiento_km_gal is not null
    and rc.rendimiento_km_gal between v_min and v_max
    and coalesce(rc.km_recorridos, 0) >= v_distmin
    and coalesce(v.tipo,'') not in ('motocicleta','automovil','suv','pickup','otro');

  return (
    with echadas as (
      select rc.vehiculo_id,
             coalesce(nullif(trim(v.placa),''), v.marca, 'Vehículo') placa,
             v.rendimiento_esperado_km_gal esperado,
             coalesce(rc.km_recorridos, 0) km, coalesce(rc.galones, 0) gal, coalesce(rc.monto, 0) monto,
             rc.rendimiento_km_gal rend,
             (coalesce(rc.km_recorridos, 0) >= v_distmin
               and rc.rendimiento_km_gal is not null
               and rc.rendimiento_km_gal between v_min and v_max) as rend_ok,
             (rc.km_recorridos is null or rc.km_recorridos = 0) as km_sucio
      from sgc.registros_combustible rc
      join sgc.vehiculos v on v.id = rc.vehiculo_id
      where rc.fecha between v_ini and v_fin
        and not coalesce(rc.invalidada, false)
        and not coalesce(rc.es_prueba, false)
        and coalesce(v.tipo,'') not in ('motocicleta','automovil','suv','pickup','otro')
    ),
    -- Promedio histórico plausible por vehículo (para la cascada si no hay "esperado").
    hist as (
      select rc.vehiculo_id, round(avg(rc.rendimiento_km_gal), 1) prom, count(*) n
      from sgc.registros_combustible rc
      where not coalesce(rc.invalidada, false) and not coalesce(rc.es_prueba, false)
        and rc.rendimiento_km_gal is not null
        and rc.rendimiento_km_gal between v_min and v_max
        and coalesce(rc.km_recorridos, 0) >= v_distmin
      group by rc.vehiculo_id
    )
    select jsonb_build_object(
      'anio', v_anio, 'semana', v_sem, 'inicio', v_ini, 'fin', v_fin,
      'total_galones', coalesce((select sum(gal) from echadas), 0),
      'total_km', coalesce((select sum(km) from echadas), 0),
      'total_costo', coalesce((select sum(monto) from echadas), 0),
      'km_en_depuracion', (select count(*) from echadas where km_sucio) > 0,
      'flota_rendimiento_estimado', v_flota_avg,
      'por_vehiculo', coalesce((
        select jsonb_agg(jsonb_build_object(
          'placa', placa, 'km', km_t, 'galones', gal_t, 'costo', monto_t, 'echadas', n,
          'rendimiento', rend_sem,                                   -- null => datos insuficientes
          'rendimiento_estimado', coalesce(esperado, hist_prom, v_flota_avg),
          'km_depurado', km_sucio_n > 0
        ) order by gal_t desc)
        from (
          select e.vehiculo_id, e.placa,
                 max(e.esperado) esperado,
                 sum(e.km) km_t, sum(e.gal) gal_t, sum(e.monto) monto_t, count(*) n,
                 round(avg(e.rend) filter (where e.rend_ok), 1) rend_sem,
                 count(*) filter (where e.km_sucio) km_sucio_n,
                 (select h.prom from hist h where h.vehiculo_id = e.vehiculo_id and h.n >= v_minreg) hist_prom
          from echadas e group by e.vehiculo_id, e.placa
        ) x), '[]'::jsonb)
    )
  );
end;
$function$;

commit;
