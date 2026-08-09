-- =============================================================================
-- PROMPT-13 FASE 3 (AJ14) — Tracking robusto + TRAZADO visual del recorrido.
-- Ronda 08/08/2026 (IDs AJ). SGC padre. Aditivo, idempotente, retrocompatible.
--
-- Patrón objetivo (research CONTEXTO §E — Samsara/Motive/Onfleet):
--   1) Ingesta BATCH validada: descartar accuracy mala y saltos imposibles;
--      tag opcional de ruta por punto. (registrar_posiciones ya existía; se
--      endurece conservando su contrato.)
--   2) Retención de crudos configurable (~90 días, antes 7).
--   3) POLYLINE consolidada guardada en la ruta al finalizar (encoded polyline +
--      GeoJSON de coords + km del trazado) para replay barato tras el purgado.
--   4) Lecturas: breadcrumb de la ruta ACTIVA (vivo) + trayecto del histórico.
--   5) Telemetría de huecos: ruta activa sin puntos por >X min ⇒ evento Y6
--      (gps_eventos 'operando_sin_gps') para diagnosticar Xiaomi/MIUI.
-- =============================================================================

begin;

-- ── 0) Parámetros del tracking ───────────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('gps_retencion_dias',    '90',  'AJ14 — días de retención de posiciones crudas (chofer_posiciones).'),
  ('gps_precision_max_m',   '100', 'AJ14 — precisión máxima aceptada (m); puntos peores se descartan.'),
  ('gps_velocidad_max_kmh', '160', 'AJ14 — velocidad máxima plausible (km/h); saltos que la superan se descartan.'),
  ('gps_hueco_minutos',     '12',  'AJ14 — minutos sin puntos con ruta activa antes de registrar "operando_sin_gps".'),
  ('gps_downsample_m',      '8',   'AJ14 — distancia mínima (m) entre puntos al consolidar el trayecto.')
on conflict (clave) do nothing;

-- ── 1) Columnas: tag de ruta en crudos + trayecto consolidado en la ruta ─────
alter table sgc.chofer_posiciones add column if not exists ruta_id uuid references sgc.rutas(id) on delete set null;
create index if not exists idx_chofer_posiciones_ruta on sgc.chofer_posiciones(ruta_id, capturado_en);

alter table sgc.rutas add column if not exists trayecto              jsonb;   -- [[lat,lng],...] consolidado
alter table sgc.rutas add column if not exists trayecto_polyline     text;    -- encoded polyline (Google)
alter table sgc.rutas add column if not exists trayecto_puntos       integer;
alter table sgc.rutas add column if not exists km_trazado            numeric(10,2);
alter table sgc.rutas add column if not exists trayecto_consolidado_at timestamptz;

comment on column sgc.rutas.trayecto          is 'AJ14 — coords consolidadas del recorrido [[lat,lng],...] (replay barato).';
comment on column sgc.rutas.trayecto_polyline is 'AJ14 — encoded polyline (algoritmo Google) del recorrido.';
comment on column sgc.rutas.km_trazado        is 'AJ14 — km recorridos calculados por GPS (haversine sobre el trayecto).';

-- ── 2) Distancia haversine (km) ──────────────────────────────────────────────
create or replace function sgc.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql immutable
as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then 0
  else 6371 * 2 * asin(sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )) end;
$$;

-- ── 3) Encoder de polyline (algoritmo estándar Google, escala 1e5) ───────────
create or replace function sgc._pl_chunk(p_delta bigint)
returns text
language plpgsql immutable
as $$
declare v bigint; r text := '';
begin
  v := p_delta << 1;
  if p_delta < 0 then v := ~ v; end if;
  while v >= 32 loop
    r := r || chr(((32 | (v & 31)) + 63)::int);
    v := v >> 5;
  end loop;
  r := r || chr((v + 63)::int);
  return r;
end;
$$;

create or replace function sgc.encode_polyline(p_coords jsonb)
returns text
language plpgsql immutable
as $$
declare
  v_out text := '';
  v_prev_lat bigint := 0; v_prev_lng bigint := 0;
  v_lat bigint; v_lng bigint; it jsonb;
begin
  if p_coords is null then return ''; end if;
  for it in select * from jsonb_array_elements(p_coords) loop
    v_lat := round(((it->>0)::numeric) * 100000);
    v_lng := round(((it->>1)::numeric) * 100000);
    v_out := v_out || sgc._pl_chunk(v_lat - v_prev_lat);
    v_out := v_out || sgc._pl_chunk(v_lng - v_prev_lng);
    v_prev_lat := v_lat; v_prev_lng := v_lng;
  end loop;
  return v_out;
end;
$$;
grant execute on function sgc.encode_polyline(jsonb) to authenticated, service_role;

-- ── 4) registrar_posiciones: ingesta batch VALIDADA (accuracy + saltos + ruta) ─
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
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para registrar posición';
  end if;

  -- Punto previo del usuario (para filtrar saltos imposibles).
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

    -- (a) accuracy mala → descartar.
    if v_prec is not null and v_prec > v_prec_max then continue; end if;

    -- (b) salto imposible respecto al punto previo → descartar.
    if v_plat is not null and v_pcap is not null and v_cap > v_pcap then
      v_dist  := sgc.haversine_km(v_plat, v_plng, v_lat, v_lng);
      v_dt    := extract(epoch from (v_cap - v_pcap)) / 3600.0;  -- horas
      if v_dt > 0 then
        v_speed := v_dist / v_dt;
        if v_speed > v_vel_max then continue; end if;
      end if;
    end if;

    insert into sgc.chofer_posiciones (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en, ruta_id)
    values (v_uid, nullif(it->>'vehiculo_id','')::uuid, v_lat, v_lng, v_prec,
            nullif(it->>'bateria','')::int, v_cap, v_ruta);
    v_n := v_n + 1;
    v_plat := v_lat; v_plng := v_lng; v_pcap := v_cap;  -- avanza el previo

    if v_last_cap is null or v_cap >= v_last_cap then
      v_last_cap := v_cap; v_last := it;
    end if;
  end loop;

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

  return v_n;
end;
$$;
grant execute on function sgc.registrar_posiciones(jsonb) to authenticated, service_role;

-- ── 5) Consolidar el trayecto de una ruta (encoded polyline + coords + km) ───
create or replace function sgc.consolidar_trayecto_ruta(p_ruta_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_r sgc.rutas%rowtype;
  v_uid uuid;
  v_min_m numeric := coalesce((select valor from sgc.parametros where clave='gps_downsample_m')::numeric, 8);
  v_coords jsonb := '[]'::jsonb;
  v_km numeric := 0; v_n int := 0;
  v_plat numeric; v_plng numeric; rec record;
begin
  select * into v_r from sgc.rutas where id = p_ruta_id;
  if not found then raise exception 'Ruta no encontrada.'; end if;
  select usuario_id into v_uid from sgc.conductores where id = v_r.conductor_id;

  for rec in
    select lat, lng, capturado_en from sgc.chofer_posiciones
    where ( ruta_id = p_ruta_id
            or (ruta_id is null and v_uid is not null and usuario_id = v_uid
                and capturado_en >= coalesce(v_r.iniciada_at, v_r.created_at)
                and capturado_en <= coalesce(v_r.finalizada_at, now())) )
    order by capturado_en asc
  loop
    -- downsample: salta puntos casi idénticos al previo consolidado.
    if v_plat is not null and sgc.haversine_km(v_plat, v_plng, rec.lat, rec.lng) * 1000 < v_min_m then
      continue;
    end if;
    if v_plat is not null then
      v_km := v_km + sgc.haversine_km(v_plat, v_plng, rec.lat, rec.lng);
    end if;
    v_coords := v_coords || jsonb_build_array(jsonb_build_array(rec.lat, rec.lng));
    v_plat := rec.lat; v_plng := rec.lng; v_n := v_n + 1;
  end loop;

  update sgc.rutas set
    trayecto = v_coords,
    trayecto_polyline = sgc.encode_polyline(v_coords),
    trayecto_puntos = v_n,
    km_trazado = round(v_km, 2),
    trayecto_consolidado_at = now()
  where id = p_ruta_id;

  return jsonb_build_object('ruta_id', p_ruta_id, 'puntos', v_n, 'km', round(v_km,2));
end;
$$;
grant execute on function sgc.consolidar_trayecto_ruta(uuid) to authenticated, service_role;

-- ── 6) Trigger: al finalizar/cancelar la ruta, consolidar ANTES del purgado ──
create or replace function sgc.tg_ruta_consolidar_trayecto()
returns trigger
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if new.estado in ('completada','cancelada')
     and coalesce(old.estado,'') is distinct from new.estado
     and new.trayecto_consolidado_at is null then
    perform sgc.consolidar_trayecto_ruta(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ruta_consolidar_trayecto on sgc.rutas;
create trigger trg_ruta_consolidar_trayecto
  after update on sgc.rutas
  for each row execute function sgc.tg_ruta_consolidar_trayecto();

-- ── 7) Lecturas de trazado ───────────────────────────────────────────────────
-- Breadcrumb de la ruta ACTIVA (vivo): puntos crudos recientes del conductor.
create or replace function sgc.ruta_breadcrumb_vivo(p_ruta_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_r sgc.rutas%rowtype; v_uid uuid; v_admin boolean := sgc.is_admin() or sgc.es_flota_elevado();
begin
  select * into v_r from sgc.rutas where id = p_ruta_id;
  if not found then return null; end if;
  select usuario_id into v_uid from sgc.conductores where id = v_r.conductor_id;
  -- solo el propio chofer o flota elevada
  if not (v_admin or v_uid = auth.uid()) then raise exception 'No autorizado'; end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_array(lat, lng) order by capturado_en), '[]'::jsonb)
    from sgc.chofer_posiciones
    where ( ruta_id = p_ruta_id
            or (ruta_id is null and v_uid is not null and usuario_id = v_uid
                and capturado_en >= coalesce(v_r.iniciada_at, v_r.created_at)) )
  );
end;
$$;
grant execute on function sgc.ruta_breadcrumb_vivo(uuid) to authenticated, service_role;

-- Trayecto del histórico: usa el consolidado; si no existe aún, lo consolida.
create or replace function sgc.ruta_trayecto(p_ruta_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_r sgc.rutas%rowtype;
begin
  select * into v_r from sgc.rutas where id = p_ruta_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'ruta_id', v_r.id,
    'polyline', v_r.trayecto_polyline,
    'coords',   coalesce(v_r.trayecto, '[]'::jsonb),
    'puntos',   coalesce(v_r.trayecto_puntos, 0),
    'km',       v_r.km_trazado,
    'consolidado_at', v_r.trayecto_consolidado_at
  );
end;
$$;
grant execute on function sgc.ruta_trayecto(uuid) to authenticated, service_role;

-- ── 8) Retención configurable de crudos (antes fija a 7 días) ────────────────
create or replace function sgc.purgar_posiciones_viejas()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_dias int := coalesce((select valor from sgc.parametros where clave='gps_retencion_dias')::int, 90); v_n int;
begin
  delete from sgc.chofer_posiciones where capturado_en < now() - make_interval(days => v_dias);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 9) Telemetría de huecos: ruta activa sin puntos por >X min ⇒ Y6 ──────────
create or replace function sgc.detectar_huecos_tracking()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_min int := coalesce((select valor from sgc.parametros where clave='gps_hueco_minutos')::int, 12);
  rec record; v_ult timestamptz; v_n int := 0;
begin
  for rec in
    select r.id as ruta_id, c.usuario_id
    from sgc.rutas r join sgc.conductores c on c.id = r.conductor_id
    where r.estado = 'en_curso' and c.usuario_id is not null
  loop
    select max(capturado_en) into v_ult from sgc.chofer_posiciones
      where usuario_id = rec.usuario_id;
    if v_ult is null or v_ult < now() - make_interval(mins => v_min) then
      -- dedup: no repetir si ya hay un evento reciente
      if not exists (
        select 1 from sgc.gps_eventos g
        where g.usuario_id = rec.usuario_id and g.tipo = 'operando_sin_gps'
          and g.created_at > now() - make_interval(mins => v_min)
      ) then
        insert into sgc.gps_eventos (usuario_id, tipo, detalle)
        values (rec.usuario_id, 'operando_sin_gps',
                'Ruta activa sin posiciones por más de '||v_min||' min (posible bloqueo de batería/MIUI).');
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end;
$$;
grant execute on function sgc.detectar_huecos_tracking() to service_role;

-- Cron: cada 5 min detecta huecos.
do $$ begin
  perform cron.schedule('sgc-huecos-tracking', '*/5 * * * *', $cron$ select sgc.detectar_huecos_tracking(); $cron$);
exception when others then null; end $$;

commit;
