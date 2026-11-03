-- sql/2026-11-02-dg3-tablero-en-ruta.sql — Ronda DG (PROMPT-128, DG3)
-- Arregla 3 huecos reales del tablero "Hoy, en vivo" (sgc.tablero_vivo_resumen,
-- create or replace ADITIVO sobre sql/2026-11-02-df6d-tablero-eta.sql) que hacían
-- que el dashboard mostrara números que no cuadraban entre sí:
--
--   1) flujo.en_ruta no tenía ventana de tiempo: contaba conduces en tránsito de
--      hace semanas/meses igual que los de hoy (causa real de "10 en ruta" con
--      "0 conduces hoy" — eran conduces viejos atascados, no movimiento de hoy).
--      Ahora en_ruta = transito_at en las últimas 48h, y se agrega
--      flujo.atrasados = los que llevan MÁS de 48h en tránsito sin entregar, con
--      su propio detalle abrible (sgc.conduces_atrasados_detalle, AT11).
--   2) kpis.vehiculos_en_uso contaba TODO uso abierto (fin_at is null) sin
--      importar hace cuánto se abrió — un uso de hace semanas sin cerrar contaba
--      igual que uno de hoy. Ahora solo cuenta usos abiertos en las últimas 24h,
--      y se agrega kpis.usos_sin_cerrar = usos abiertos hace MÁS de 24h, con su
--      propio detalle abrible (sgc.usos_sin_cerrar_detalle, AT11).
--   3) "flota" filtraba por el día calendario de Santo Domingo (una posición de
--      hace 1 minuto "de ayer" desaparecía justo después de medianoche) y no
--      exponía la edad de cada posición, así que el cliente no podía pintar
--      "sin señal" de forma honesta. Ahora es una ventana rodante de 12h y cada
--      posición trae edad_min (minutos desde capturado_en hasta ahora).
--
-- Mantiene intactos destino_lat/destino_lng/destino_texto/velocidad_estim_kmh
-- (ETA, df6d) y todo lo demás de kpis/flujo/eventos.
--
-- Apply: node scripts/apply-migration.mjs sql/2026-11-02-dg3-tablero-en-ruta.sql --env dev --yes

begin;
set local search_path = sgc, public;

-- ── 1) RPC principal del tablero (create or replace aditivo) ──────────────────
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
    -- DG3: solo usos abiertos en las últimas 24h cuentan como "en uso hoy".
    'vehiculos_en_uso', (select count(distinct vu.vehiculo_id) from sgc.vehiculo_usos vu
       where vu.fin_at is null and vu.inicio_at > now() - interval '24 hours'
         and (v_admin or not coalesce(vu.es_prueba, false))),
    -- DG3: usos abiertos hace más de 24h (probable olvido de cerrar) — aparte, abrible.
    'usos_sin_cerrar', (select count(distinct vu.vehiculo_id) from sgc.vehiculo_usos vu
       where vu.fin_at is null and vu.inicio_at <= now() - interval '24 hours'
         and (v_admin or not coalesce(vu.es_prueba, false))),
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
    -- DG3: en_ruta ahora es una ventana rodante de 48h (antes contaba conduces
    -- en tránsito de hace semanas igual que los de hoy).
    'en_ruta', (select count(*) from sgc.salidas_inventario sa
       where sa.transito_at is not null and sa.entregado_en is null
         and sa.estado = 'despachado' and sa.transito_at > now() - interval '48 hours'
         and (v_admin or not coalesce(sa.es_prueba, false))),
    -- DG3: atrasados = en tránsito hace MÁS de 48h sin entregar — aparte, abrible.
    'atrasados', (select count(*) from sgc.salidas_inventario sa
       where sa.transito_at is not null and sa.entregado_en is null
         and sa.estado = 'despachado' and sa.transito_at <= now() - interval '48 hours'
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

  -- Flota en vivo + ETA. DG3: ventana rodante de 12h (antes: día calendario de
  -- Santo Domingo, que rompía justo después de medianoche) + edad_min expuesta
  -- para que el cliente pinte "sin señal" sin tener que reinventar el cálculo.
  select coalesce(jsonb_agg(jsonb_build_object(
      'vehiculo_id', cp.vehiculo_id,
      'placa', v.placa,
      'alias', v.alias,
      'chofer', u.nombre,
      'lat', cp.lat, 'lng', cp.lng,
      'capturado_en', cp.capturado_en,
      'edad_min', round(extract(epoch from (now() - cp.capturado_en)) / 60.0)::int,
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
  where cp.capturado_en > now() - interval '12 hours'
    and (v_admin or not coalesce(v.es_prueba, false));

  return jsonb_build_object(
    'kpis', v_kpis, 'flujo', v_flujo, 'eventos', v_eventos, 'flota', v_flota,
    'generado_en', now());
end $function$;

grant execute on function sgc.tablero_vivo_resumen() to authenticated;
revoke execute on function sgc.tablero_vivo_resumen() from public;

-- ── 2) Detalle de "atrasados" (AT11 — todo número visible se puede abrir) ──────
create or replace function sgc.conduces_atrasados_detalle()
returns table (
  referencia text,
  obra text,
  vehiculo text,
  horas_en_transito numeric,
  transito_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No tienes acceso al tablero en vivo.' using errcode = '42501';
  end if;

  return query
  select
    'CND-' || upper(left(sa.id::text, 8)),
    coalesce(p.nombre, ''),
    coalesce(v.alias, v.placa, ''),
    round(extract(epoch from (now() - sa.transito_at)) / 3600.0, 1),
    sa.transito_at
  from sgc.salidas_inventario sa
  left join sgc.proyectos p on p.id = sa.proyecto_id
  left join sgc.vehiculos v on v.id = sa.vehiculo_id
  where sa.transito_at is not null and sa.entregado_en is null
    and sa.estado = 'despachado' and sa.transito_at <= now() - interval '48 hours'
    and (sgc.is_admin() or not coalesce(sa.es_prueba, false))
  order by sa.transito_at asc
  limit 100;
end;
$$;
grant execute on function sgc.conduces_atrasados_detalle() to authenticated;
revoke execute on function sgc.conduces_atrasados_detalle() from public;

-- ── 3) Detalle de "usos sin cerrar" (AT11) ─────────────────────────────────────
create or replace function sgc.usos_sin_cerrar_detalle()
returns table (
  vehiculo_id uuid,
  vehiculo text,
  chofer text,
  horas_abierto numeric,
  inicio_at timestamptz
)
language plpgsql stable security definer
set search_path to 'sgc', 'public'
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota')
          or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('direccion')) then
    raise exception 'No tienes acceso al tablero en vivo.' using errcode = '42501';
  end if;

  return query
  select
    vu.vehiculo_id,
    coalesce(v.alias, v.placa, ''),
    coalesce(u.nombre, ''),
    round(extract(epoch from (now() - vu.inicio_at)) / 3600.0, 1),
    vu.inicio_at
  from sgc.vehiculo_usos vu
  left join sgc.vehiculos v on v.id = vu.vehiculo_id
  left join sgc.usuarios u on u.id = vu.usuario_id
  where vu.fin_at is null and vu.inicio_at <= now() - interval '24 hours'
    and (sgc.is_admin() or not coalesce(vu.es_prueba, false))
  order by vu.inicio_at asc
  limit 100;
end;
$$;
grant execute on function sgc.usos_sin_cerrar_detalle() to authenticated;
revoke execute on function sgc.usos_sin_cerrar_detalle() from public;

commit;
