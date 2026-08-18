-- ════════════════════════════════════════════════════════════════════════════
-- AV8 — Endurecer la ingesta de posiciones (filtro de outliers)
-- ════════════════════════════════════════════════════════════════════════════
-- Diagnóstico del "salto" de Misael Encarnacion (08-18): NO hubo un outlier real
-- de GPS — su mayor velocidad implícita fue 159 km/h en 151 s sobre autopista
-- (viaje legítimo). El "teletransporte" percibido era el MARCADOR EN VIVO yendo
-- hacia atrás cuando llegaba un batch atrasado del buffer offline. Ese caso YA
-- está cubierto por el guard de AU7 en chofer_ultima_posicion
-- (where excluded.capturado_en >= chofer_ultima_posicion.capturado_en).
--
-- Este parche agrega defensa en profundidad: descartar coordenadas fuera de RD
-- (atrapa lat/lng invertidos o basura de torre celular) además de los filtros
-- de accuracy (>100 m) y salto imposible (>160 km/h) que ya existen. Recrea
-- registrar_posiciones (AU7) fiel, insertando el check de bounding box en el loop
-- ANTES de fijar el "último punto", para que un punto inválido nunca se convierta
-- en la posición en vivo. Aditivo/retrocompatible.
-- ════════════════════════════════════════════════════════════════════════════

-- Bounding box de República Dominicana (con margen). Fuera de esto = punto basura.
create or replace function sgc._punto_en_rd(p_lat numeric, p_lng numeric)
returns boolean
language sql immutable
as $$
  select p_lat is not null and p_lng is not null
     and p_lat between 17.3 and 20.2
     and p_lng between -72.2 and -68.1;
$$;
grant execute on function sgc._punto_en_rd(numeric, numeric) to authenticated, service_role;

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

    -- AV8 — fuera de RD (lat/lng invertidos o basura): descartar.
    if not sgc._punto_en_rd(v_lat, v_lng) then continue; end if;

    -- accuracy: descartar muy impreciso.
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

  foreach v_dia in array v_dias_viejos loop
    perform sgc.consolidar_recorrido_diario(v_uid, v_dia);
  end loop;

  return v_n;
end;
$$;
grant execute on function sgc.registrar_posiciones(jsonb) to authenticated, service_role;
comment on function sgc.registrar_posiciones(jsonb) is
  'AJ14/AU7/AV8 — ingesta batch validada (bounding box RD + accuracy + saltos + ruta). Respeta el timestamp del cliente (buffer offline), no teletransporta el marcador (guard capturado_en) y re-consolida días atrasados.';
