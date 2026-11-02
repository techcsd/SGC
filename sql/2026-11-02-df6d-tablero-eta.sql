-- F6b (ronda DF, DF4-C) — ETA explicita en el tablero multi-vehiculo.
-- Extiende tablero_vivo_resumen() (ronda DB) para que cada vehiculo de "flota"
-- traiga, SI tiene una ruta en curso (sgc.rutas: iniciada_at is not null,
-- finalizada_at is null, para ese vehiculo_id): el destino real
-- (destino_lat/destino_lng) y una velocidad de referencia derivada del propio
-- estimado de la ruta (km_estimado / tiempo_estimado_min) -- nunca una velocidad
-- inventada. El front calcula la distancia restante con la MISMA geo.util.ts ya
-- usada en el resto de la ronda (rumbo/distancia, F6) y aplica esa velocidad; si
-- la ruta no tiene km_estimado o tiempo_estimado_min, el campo va null y el
-- front muestra "ETA no disponible" en vez de un numero sin sustento.
create or replace function sgc.tablero_vivo_resumen()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_admin boolean := sgc.is_admin();
  v_kpis jsonb;
  v_flujo jsonb;
  v_eventos jsonb;
  v_flota jsonb;
begin
  if not (v_admin or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No tienes acceso al tablero en vivo.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'requisiciones_hoy', (select count(*) from sgc.solicitudes_material s
       where (s.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))),
    'conduces_hoy', (select count(*) from sgc.salidas_inventario sa
       where (sa.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and sa.estado <> 'anulado' and (v_admin or not coalesce(sa.es_prueba, false))),
    'entregas_hoy', (select count(*) from sgc.salidas_inventario sa
       where sa.entregado_en is not null
         and (sa.entregado_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(sa.es_prueba, false))),
    'echadas_hoy', (select count(*) from sgc.registros_combustible rc
       where rc.fecha = v_hoy and not coalesce(rc.invalidada, false)
         and (v_admin or not coalesce(rc.es_prueba, false))),
    'vehiculos_en_uso', (select count(distinct vu.vehiculo_id) from sgc.vehiculo_usos vu
       where vu.fin_at is null and (v_admin or not coalesce(vu.es_prueba, false))),
    'bitacoras_hoy', (select count(*) from sgc.bitacoras b
       where (b.created_at at time zone 'America/Santo_Domingo')::date = v_hoy)
  ) into v_kpis;

  select jsonb_build_object(
    'solicitada', (select count(*) from sgc.solicitudes_material s
       where (s.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and s.estado = 'pendiente' and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))),
    'aprobada', (select count(*) from sgc.solicitudes_material s
       where s.atendido_en is not null
         and (s.atendido_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))),
    'despachada', (select count(*) from sgc.salidas_inventario sa
       where (sa.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and sa.estado = 'despachado' and sa.transito_at is null
         and (v_admin or not coalesce(sa.es_prueba, false))),
    'en_ruta', (select count(*) from sgc.salidas_inventario sa
       where sa.transito_at is not null and sa.entregado_en is null
         and sa.estado = 'despachado'
         and (v_admin or not coalesce(sa.es_prueba, false))),
    'entregada', (select count(*) from sgc.salidas_inventario sa
       where sa.entregado_en is not null
         and (sa.entregado_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(sa.es_prueba, false)))
  ) into v_flujo;

  select coalesce(jsonb_agg(e order by e->>'at' desc), '[]'::jsonb) into v_eventos
  from (
    select to_jsonb(x) as e from (
      (select 'requisicion'::text as tipo, 'Requisición ' || coalesce(s.folio::text,'') as titulo,
              coalesce((select p.nombre from sgc.proyectos p where p.id = s.proyecto_id), '') as detalle,
              s.created_at as at
       from sgc.solicitudes_material s
       where (s.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not exists (select 1 from sgc.proyectos pp where pp.id = s.proyecto_id and coalesce(pp.es_prueba,false)))
       order by s.created_at desc limit 8)
      union all
      (select 'conduce', 'Conduce despachado',
              coalesce((select p.nombre from sgc.proyectos p where p.id = sa.proyecto_id), ''),
              sa.created_at
       from sgc.salidas_inventario sa
       where (sa.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and sa.estado <> 'anulado' and (v_admin or not coalesce(sa.es_prueba, false))
       order by sa.created_at desc limit 8)
      union all
      (select 'entrega', 'Conduce entregado',
              coalesce(sa.entrega_receptor, ''),
              sa.entregado_en
       from sgc.salidas_inventario sa
       where sa.entregado_en is not null
         and (sa.entregado_en at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(sa.es_prueba, false))
       order by sa.entregado_en desc limit 8)
      union all
      (select 'combustible', 'Echada de combustible',
              coalesce((select v.alias from sgc.vehiculos v where v.id = rc.vehiculo_id),
                       (select v.placa from sgc.vehiculos v where v.id = rc.vehiculo_id), ''),
              rc.created_at
       from sgc.registros_combustible rc
       where rc.fecha = v_hoy and not coalesce(rc.invalidada, false)
         and (v_admin or not coalesce(rc.es_prueba, false))
       order by rc.created_at desc limit 8)
      union all
      (select 'uso', 'Vehículo en uso',
              coalesce((select v.alias from sgc.vehiculos v where v.id = vu.vehiculo_id),
                       (select v.placa from sgc.vehiculos v where v.id = vu.vehiculo_id), ''),
              vu.inicio_at
       from sgc.vehiculo_usos vu
       where (vu.inicio_at at time zone 'America/Santo_Domingo')::date = v_hoy
         and (v_admin or not coalesce(vu.es_prueba, false))
       order by vu.inicio_at desc limit 8)
      union all
      (select 'bitacora', 'Bitácora registrada',
              coalesce((select p.nombre from sgc.proyectos p where p.id = b.proyecto_id), ''),
              b.created_at
       from sgc.bitacoras b
       where (b.created_at at time zone 'America/Santo_Domingo')::date = v_hoy
       order by b.created_at desc limit 8)
    ) x
    order by x.at desc limit 8
  ) ult;

  -- Flota en vivo + ETA (si hay ruta en curso para ese vehiculo con estimado real).
  select coalesce(jsonb_agg(jsonb_build_object(
      'vehiculo_id', cp.vehiculo_id,
      'placa', v.placa,
      'alias', v.alias,
      'chofer', u.nombre,
      'lat', cp.lat, 'lng', cp.lng,
      'capturado_en', cp.capturado_en,
      'destino_lat', r.destino_lat,
      'destino_lng', r.destino_lng,
      'destino_texto', r.destino,
      'velocidad_estim_kmh', case
        when r.km_estimado is not null and r.tiempo_estimado_min > 0
          then round((r.km_estimado / (r.tiempo_estimado_min / 60.0))::numeric, 1)
        else null
      end)), '[]'::jsonb)
  into v_flota
  from sgc.chofer_ultima_posicion cp
  join sgc.vehiculos v on v.id = cp.vehiculo_id
  left join sgc.usuarios u on u.id = cp.usuario_id
  left join lateral (
    select r.destino_lat, r.destino_lng, r.destino, r.km_estimado, r.tiempo_estimado_min
    from sgc.rutas r
    where r.vehiculo_id = cp.vehiculo_id
      and r.iniciada_at is not null and r.finalizada_at is null
      and r.destino_lat is not null and r.destino_lng is not null
    order by r.iniciada_at desc
    limit 1
  ) r on true
  where (cp.capturado_en at time zone 'America/Santo_Domingo')::date = v_hoy
    and (v_admin or not coalesce(v.es_prueba, false));

  return jsonb_build_object(
    'kpis', v_kpis, 'flujo', v_flujo, 'eventos', v_eventos, 'flota', v_flota,
    'generado_en', now());
end $function$;
