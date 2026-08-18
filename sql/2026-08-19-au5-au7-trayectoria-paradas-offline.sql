-- ============================================================================
-- PROMPT-21 (AU) — FASE 5 — Trayectoria al completar (AU5) + detección de paradas
--   (AU7) + ingesta de batches atrasados (offline). SGC padre. Aditivo /
--   retrocompatible. Migración fechada.
-- ----------------------------------------------------------------------------
-- Contexto (CONTEXTO-ACTUALIZACION-10.md):
--   AU5: al completar una ruta, poder "ver la trayectoria" (replay). El contrato
--        ya existe (ruta_trayecto / trayecto_polyline, AJ14); esta migración sólo
--        lo documenta y expone una lectura ligera para el botón.
--   AU7: detección de PARADAS v1 sobre el stream de posiciones (velocidad ~0 por
--        ≥5 min dentro de un radio → tramos y paradas, estilo Google Timeline).
--        La geocodificación inversa del lugar la hace una edge function con la key
--        server-side (reverse-geocode). Además: la ingesta acepta BATCHES ATRASADOS
--        (puntos con timestamps viejos del buffer offline) y re-consolida los días
--        afectados para que el recorrido aparezca completo aun sin internet.
--
-- Decisiones de Xaviel (esta ronda): parada = ≥5 min sin moverse (radio 80 m).
-- ============================================================================

set search_path = sgc, public;

insert into sgc.parametros (clave, valor, descripcion) values
  ('gps_parada_min_min', '5',  'AU7 — minutos mínimos quieto (dentro del radio) para considerar una PARADA.'),
  ('gps_parada_radio_m', '80', 'AU7 — radio (m) dentro del cual se considera que el vehículo no se ha movido.')
on conflict (clave) do nothing;

-- Guardar las paradas consolidadas junto al recorrido del día.
alter table sgc.recorrido_diario add column if not exists paradas jsonb not null default '[]'::jsonb;
comment on column sgc.recorrido_diario.paradas is
  'AU7 — paradas detectadas del día [{inicio_at, fin_at, lat, lng, minutos}] (estilo Google Timeline).';

-- ════════════════════════════════════════════════════════════════════════════
-- AU7 — Detección de paradas (stay-point detection v1) sobre los crudos del día
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc._recorrido_paradas(p_uid uuid, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_min_min numeric := coalesce((select valor from sgc.parametros where clave='gps_parada_min_min')::numeric, 5);
  v_radio_m numeric := coalesce((select valor from sgc.parametros where clave='gps_parada_radio_m')::numeric, 80);
  v_paradas jsonb := '[]'::jsonb;
  -- ancla del cluster actual (primer punto), acumuladores del centroide y tiempos
  v_alat numeric; v_alng numeric;
  v_sum_lat numeric := 0; v_sum_lng numeric := 0; v_n int := 0;
  v_ini timestamptz; v_fin timestamptz;
  v_min numeric;
  rec record;
begin
  for rec in
    select lat, lng, capturado_en
      from sgc.chofer_posiciones
     where usuario_id = p_uid
       and (capturado_en at time zone 'America/Santo_Domingo')::date = p_fecha
     order by capturado_en asc
  loop
    if v_alat is null then
      -- iniciar cluster
      v_alat := rec.lat; v_alng := rec.lng;
      v_sum_lat := rec.lat; v_sum_lng := rec.lng; v_n := 1;
      v_ini := rec.capturado_en; v_fin := rec.capturado_en;
    elsif sgc.haversine_km(v_alat, v_alng, rec.lat, rec.lng) * 1000 <= v_radio_m then
      -- sigue dentro del radio → mismo cluster (extiende tiempo + centroide)
      v_sum_lat := v_sum_lat + rec.lat; v_sum_lng := v_sum_lng + rec.lng; v_n := v_n + 1;
      v_fin := rec.capturado_en;
    else
      -- salió del radio → cerrar cluster; emitir si duró suficiente
      v_min := extract(epoch from (v_fin - v_ini)) / 60.0;
      if v_min >= v_min_min then
        v_paradas := v_paradas || jsonb_build_array(jsonb_build_object(
          'inicio_at', v_ini, 'fin_at', v_fin,
          'lat', round(v_sum_lat / v_n, 6), 'lng', round(v_sum_lng / v_n, 6),
          'minutos', round(v_min)));
      end if;
      -- iniciar nuevo cluster con el punto actual
      v_alat := rec.lat; v_alng := rec.lng;
      v_sum_lat := rec.lat; v_sum_lng := rec.lng; v_n := 1;
      v_ini := rec.capturado_en; v_fin := rec.capturado_en;
    end if;
  end loop;

  -- cerrar el último cluster
  if v_alat is not null then
    v_min := extract(epoch from (v_fin - v_ini)) / 60.0;
    if v_min >= v_min_min then
      v_paradas := v_paradas || jsonb_build_array(jsonb_build_object(
        'inicio_at', v_ini, 'fin_at', v_fin,
        'lat', round(v_sum_lat / v_n, 6), 'lng', round(v_sum_lng / v_n, 6),
        'minutos', round(v_min)));
    end if;
  end if;

  return v_paradas;
end;
$$;
grant execute on function sgc._recorrido_paradas(uuid, date) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Consolidación del recorrido diario — ahora también guarda las paradas
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.consolidar_recorrido_diario(p_uid uuid, p_fecha date)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_tramos jsonb := sgc._recorrido_tramos(p_uid, p_fecha);
  v_paradas jsonb := sgc._recorrido_paradas(p_uid, p_fecha);
  v_coords jsonb := '[]'::jsonb;
  v_km numeric := 0; v_pri timestamptz; v_ult timestamptz;
  t jsonb;
begin
  for t in select * from jsonb_array_elements(v_tramos) loop
    v_coords := v_coords || (t->'coords');
    v_km := v_km + coalesce((t->>'km')::numeric, 0);
    if v_pri is null then v_pri := (t->>'inicio_at')::timestamptz; end if;
    v_ult := (t->>'fin_at')::timestamptz;
  end loop;

  if jsonb_array_length(v_coords) = 0 then
    delete from sgc.recorrido_diario where usuario_id = p_uid and fecha = p_fecha;
    return jsonb_build_object('usuario_id', p_uid, 'fecha', p_fecha, 'puntos', 0);
  end if;

  insert into sgc.recorrido_diario
    (usuario_id, fecha, coords, polyline, tramos, paradas, puntos, km, primer_at, ultimo_at, consolidado_at)
  values
    (p_uid, p_fecha, v_coords, sgc.encode_polyline(v_coords), v_tramos, v_paradas,
     jsonb_array_length(v_coords), round(v_km,2), v_pri, v_ult, now())
  on conflict (usuario_id, fecha) do update
    set coords = excluded.coords, polyline = excluded.polyline, tramos = excluded.tramos,
        paradas = excluded.paradas, puntos = excluded.puntos, km = excluded.km,
        primer_at = excluded.primer_at, ultimo_at = excluded.ultimo_at,
        consolidado_at = now();

  return jsonb_build_object('usuario_id', p_uid, 'fecha', p_fecha,
                            'puntos', jsonb_array_length(v_coords), 'km', round(v_km,2),
                            'paradas', jsonb_array_length(v_paradas));
end;
$$;
grant execute on function sgc.consolidar_recorrido_diario(uuid, date) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Lectura del recorrido diario — ahora devuelve `paradas`
-- ════════════════════════════════════════════════════════════════════════════
create or replace function sgc.recorrido_diario_de(p_usuario_id uuid, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_row sgc.recorrido_diario%rowtype;
  v_tramos jsonb; v_paradas jsonb; v_coords jsonb := '[]'::jsonb; v_km numeric := 0;
  v_pri timestamptz; v_ult timestamptz; t jsonb;
  v_nombre text;
begin
  if not (sgc.is_admin() or sgc.es_flota_elevado() or p_usuario_id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select nombre into v_nombre from sgc.usuarios where id = p_usuario_id;

  -- Fecha ya cerrada y consolidada → tabla permanente.
  if p_fecha < v_hoy then
    select * into v_row from sgc.recorrido_diario where usuario_id = p_usuario_id and fecha = p_fecha;
    if found then
      return jsonb_build_object(
        'usuario_id', p_usuario_id, 'nombre', v_nombre, 'fecha', p_fecha,
        'coords', v_row.coords, 'polyline', v_row.polyline, 'tramos', v_row.tramos,
        'paradas', coalesce(v_row.paradas, '[]'::jsonb),
        'puntos', v_row.puntos, 'km', v_row.km,
        'primer_at', v_row.primer_at, 'ultimo_at', v_row.ultimo_at, 'fuente', 'consolidado');
    end if;
  end if;

  -- Hoy o sin consolidar → cálculo en vivo desde crudos.
  v_tramos := sgc._recorrido_tramos(p_usuario_id, p_fecha);
  v_paradas := sgc._recorrido_paradas(p_usuario_id, p_fecha);
  for t in select * from jsonb_array_elements(v_tramos) loop
    v_coords := v_coords || (t->'coords');
    v_km := v_km + coalesce((t->>'km')::numeric, 0);
    if v_pri is null then v_pri := (t->>'inicio_at')::timestamptz; end if;
    v_ult := (t->>'fin_at')::timestamptz;
  end loop;

  return jsonb_build_object(
    'usuario_id', p_usuario_id, 'nombre', v_nombre, 'fecha', p_fecha,
    'coords', v_coords, 'polyline', sgc.encode_polyline(v_coords), 'tramos', v_tramos,
    'paradas', v_paradas,
    'puntos', jsonb_array_length(v_coords), 'km', round(v_km,2),
    'primer_at', v_pri, 'ultimo_at', v_ult, 'fuente', 'vivo');
end;
$$;
grant execute on function sgc.recorrido_diario_de(uuid, date) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AU7 — Ingesta de batches ATRASADOS (offline): re-consolidar días viejos
-- ════════════════════════════════════════════════════════════════════════════
-- registrar_posiciones (AJ14) ya respeta el timestamp del cliente (buffer offline).
-- Aquí se recrea conservando TODA su validación y, al final, si el batch trajo
-- puntos de días ya pasados (llegaron tarde), re-consolida esos días para que el
-- recorrido diario los integre. Los puntos de hoy se consolidan por el cron nocturno.
create or replace function sgc.registrar_posiciones(p_posiciones jsonb)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  it jsonb; v_n int := 0;
  v_last_cap timestamptz; v_last jsonb;
  v_prec_max numeric := coalesce((select valor from sgc.parametros where clave='gps_precision_max_m')::numeric, 100);
  v_vel_max  numeric := coalesce((select valor from sgc.parametros where clave='gps_velocidad_max_kmh')::numeric, 160);
  v_lat numeric; v_lng numeric; v_prec numeric; v_cap timestamptz; v_ruta uuid;
  v_plat numeric; v_plng numeric; v_pcap timestamptz; v_dist numeric; v_dt numeric; v_speed numeric;
  v_hoy date := (now() at time zone 'America/Santo_Domingo')::date;
  v_dias_viejos date[] := '{}';
  v_dia date;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para registrar posición';
  end if;

  select lat, lng, capturado_en into v_plat, v_plng, v_pcap
    from sgc.chofer_posiciones where usuario_id = v_uid
    order by capturado_en desc limit 1;

  for it in select * from jsonb_array_elements(coalesce(p_posiciones, '[]'::jsonb))
  loop
    if (it->>'lat') is null or (it->>'lng') is null then continue; end if;
    v_lat  := (it->>'lat')::numeric;
    v_lng  := (it->>'lng')::numeric;
    v_prec := nullif(it->>'precision','')::numeric;
    v_cap  := coalesce(nullif(it->>'capturado_en','')::timestamptz, now());
    v_ruta := nullif(it->>'ruta_id','')::uuid;

    if v_prec is not null and v_prec > v_prec_max then continue; end if;

    -- salto imposible sólo si el punto es MÁS NUEVO que el previo (los atrasados
    -- del buffer offline no se validan contra el más reciente: no aplica).
    if v_plat is not null and v_pcap is not null and v_cap > v_pcap then
      v_dist  := sgc.haversine_km(v_plat, v_plng, v_lat, v_lng);
      v_dt    := extract(epoch from (v_cap - v_pcap)) / 3600.0;
      if v_dt > 0 then
        v_speed := v_dist / v_dt;
        if v_speed > v_vel_max then continue; end if;
      end if;
    end if;

    insert into sgc.chofer_posiciones (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en, ruta_id)
    values (v_uid, nullif(it->>'vehiculo_id','')::uuid, v_lat, v_lng, v_prec,
            nullif(it->>'bateria','')::int, v_cap, v_ruta);
    v_n := v_n + 1;

    -- registrar día viejo (llegó tarde) para re-consolidar al final.
    v_dia := (v_cap at time zone 'America/Santo_Domingo')::date;
    if v_dia < v_hoy and not (v_dia = any(v_dias_viejos)) then
      v_dias_viejos := array_append(v_dias_viejos, v_dia);
    end if;

    if v_cap > v_pcap or v_pcap is null then
      v_plat := v_lat; v_plng := v_lng; v_pcap := v_cap;  -- avanza el previo sólo hacia adelante
    end if;

    if v_last_cap is null or v_cap >= v_last_cap then
      v_last_cap := v_cap; v_last := it;
    end if;
  end loop;

  -- Última posición en vivo: sólo si el batch trae algo MÁS NUEVO que lo guardado.
  if v_last is not null then
    insert into sgc.chofer_ultima_posicion (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en, updated_at)
    values (v_uid, nullif(v_last->>'vehiculo_id','')::uuid,
            (v_last->>'lat')::numeric, (v_last->>'lng')::numeric,
            nullif(v_last->>'precision','')::numeric, nullif(v_last->>'bateria','')::int,
            v_last_cap, now())
    on conflict (usuario_id) do update
      set vehiculo_id = excluded.vehiculo_id, lat = excluded.lat, lng = excluded.lng,
          precision_m = excluded.precision_m, bateria = excluded.bateria,
          capturado_en = excluded.capturado_en, updated_at = now()
      where excluded.capturado_en >= sgc.chofer_ultima_posicion.capturado_en;
  end if;

  -- AU7 — batches atrasados: re-consolidar los días pasados afectados.
  foreach v_dia in array v_dias_viejos loop
    perform sgc.consolidar_recorrido_diario(v_uid, v_dia);
  end loop;

  return v_n;
end;
$$;
grant execute on function sgc.registrar_posiciones(jsonb) to authenticated, service_role;

comment on function sgc.registrar_posiciones(jsonb) is
  'AJ14/AU7 — ingesta batch validada (accuracy + saltos + ruta). Respeta el timestamp del cliente (buffer offline) y re-consolida los días pasados cuando llegan puntos atrasados, para que el recorrido diario aparezca completo aun sin internet.';

-- ════════════════════════════════════════════════════════════════════════════
-- AU7 — Caché de geocodificación inversa (la llena la edge function reverse-geocode)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists sgc.geocode_cache (
  lat_key    numeric not null,   -- lat redondeada a 4 decimales (~11 m)
  lng_key    numeric not null,
  direccion  text,
  created_at timestamptz not null default now(),
  primary key (lat_key, lng_key)
);
comment on table sgc.geocode_cache is
  'AU7 — caché de geocodificación inversa (lat/lng redondeadas → dirección) para nombrar las paradas del recorrido sin gastar cuota de Google en cada visita.';

alter table sgc.geocode_cache enable row level security;
drop policy if exists "geocode_cache: read auth" on sgc.geocode_cache;
create policy "geocode_cache: read auth" on sgc.geocode_cache
  for select to authenticated using (auth.uid() is not null);
grant select on sgc.geocode_cache to authenticated;
grant select, insert on sgc.geocode_cache to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- AU5 — Trayectoria al completar: el contrato ya existe (ruta_trayecto, AJ14).
-- ════════════════════════════════════════════════════════════════════════════
-- Se documenta: la web (Rutas / detalle de ruta finalizada) y la app llaman
-- sgc.ruta_trayecto(ruta_id) → {polyline, coords, puntos, km}. El trigger
-- trg_ruta_consolidar_trayecto consolida al completar/cancelar. No hace falta un
-- contrato nuevo; el botón "Ver trayectoria" reutiliza esta lectura.
