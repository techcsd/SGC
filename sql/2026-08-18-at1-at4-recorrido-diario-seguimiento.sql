-- AT1 + AT4 — Recorrido diario tipo Google Timeline + Seguimiento solo de quienes comparten ubicación.
--
-- Contexto (diagnóstico Ronda AT):
--   • El tracking corre durante la JORNADA (AF27), no solo en ruta: hay puntos crudos con
--     ruta_id NULL (p. ej. Misael, Joan López capturando ahora mismo) que HOY no tienen vista.
--     AT11 (regla madre): toda data enviada debe poder visualizarse → aquí nace la vista de
--     recorrido diario por usuario/fecha (derivada de sgc.chofer_posiciones).
--   • AT4: sgc.chofer_ultima_posicion arrastra filas viejas de usuarios que NO comparten
--     ubicación (Xaviel, Eduardo NG — pre-AO6). Seguimiento las pinta como marcadores. Se
--     purgan y la lectura se blinda a comparte_ubicacion server-side.
--
-- Aditivo y retrocompatible. Reutiliza sgc.haversine_km / sgc.encode_polyline (AJ14),
-- sgc.comparte_ubicacion (AO6), sgc.es_flota_elevado / sgc.is_admin.

set search_path = sgc, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Parámetros nuevos (con defaults; editables en sgc.parametros)
-- ─────────────────────────────────────────────────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('gps_tramo_gap_min', '20', 'AT1 — minutos de hueco que parten el recorrido diario en tramos separados (evita líneas rectas a través de paradas).')
on conflict (clave) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- AT4 — Seguimiento: SOLO quienes comparten ubicación
-- ═════════════════════════════════════════════════════════════════════════════

-- 1) Purga defensiva: quita del "vivo" a quien ya no comparte (colados pre-AO6).
delete from sgc.chofer_ultima_posicion cup
 where not sgc.comparte_ubicacion(cup.usuario_id);

-- 2) Lectura blindada de últimas posiciones (reemplaza el .from directo del front).
--    Devuelve SOLO sharers y solo a admin / flota elevada (o el propio usuario su fila).
create or replace function sgc.ultimas_posiciones()
returns table (
  usuario_id   uuid,
  nombre       text,
  vehiculo_id  uuid,
  placa        text,
  marca        text,
  modelo       text,
  color        text,
  lat          numeric,
  lng          numeric,
  precision_m  numeric,
  bateria      int,
  capturado_en timestamptz
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select cup.usuario_id, u.nombre, cup.vehiculo_id,
         v.placa, v.marca, v.modelo, v.color,
         cup.lat, cup.lng, cup.precision_m, cup.bateria, cup.capturado_en
    from sgc.chofer_ultima_posicion cup
    join sgc.usuarios u on u.id = cup.usuario_id
    left join sgc.vehiculos v on v.id = cup.vehiculo_id
   where sgc.comparte_ubicacion(cup.usuario_id)
     and (sgc.is_admin() or sgc.es_flota_elevado() or cup.usuario_id = auth.uid());
$$;
grant execute on function sgc.ultimas_posiciones() to authenticated, service_role;

comment on function sgc.ultimas_posiciones() is
  'AT4: últimas posiciones SOLO de usuarios que comparten ubicación (AO6), visibles a admin/flota elevada o al propio usuario. Fuente única para el mapa de Seguimiento.';

-- ═════════════════════════════════════════════════════════════════════════════
-- AT1 — Recorrido diario (Timeline) por usuario/fecha
-- ═════════════════════════════════════════════════════════════════════════════

-- Tabla PERMANENTE (sobrevive al purgado de crudos a 90 días). Un registro por
-- usuario/día con la polyline consolidada + tramos (segmentos partidos por huecos).
create table if not exists sgc.recorrido_diario (
  usuario_id     uuid not null references sgc.usuarios(id) on delete cascade,
  fecha          date not null,
  coords         jsonb not null default '[]'::jsonb,   -- todos los puntos [[lat,lng],...]
  polyline       text,                                  -- encoded polyline (todos los tramos unidos)
  tramos         jsonb not null default '[]'::jsonb,    -- [{inicio_at, fin_at, km, coords:[[lat,lng],...]}]
  puntos         int  not null default 0,
  km             numeric not null default 0,
  primer_at      timestamptz,
  ultimo_at      timestamptz,
  consolidado_at timestamptz not null default now(),
  primary key (usuario_id, fecha)
);

comment on table sgc.recorrido_diario is
  'AT1: recorrido consolidado por usuario/día (tipo Google Timeline). Permanente; los crudos (chofer_posiciones) se purgan a 90 días pero el recorrido diario queda.';

alter table sgc.recorrido_diario enable row level security;

drop policy if exists recorrido_diario_read on sgc.recorrido_diario;
create policy recorrido_diario_read on sgc.recorrido_diario for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.es_flota_elevado());

grant select on sgc.recorrido_diario to authenticated, service_role;

-- Interno: construye los tramos del día a partir de los crudos (downsample + corte por hueco).
create or replace function sgc._recorrido_tramos(p_uid uuid, p_fecha date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_min_m  numeric := coalesce((select valor from sgc.parametros where clave='gps_downsample_m')::numeric, 8);
  v_gap_min int    := coalesce((select valor from sgc.parametros where clave='gps_tramo_gap_min')::int, 20);
  v_tramos jsonb := '[]'::jsonb;
  v_seg    jsonb := '[]'::jsonb;
  v_seg_km numeric := 0; v_seg_ini timestamptz; v_seg_fin timestamptz;
  v_plat numeric; v_plng numeric; v_pcap timestamptz;
  rec record;
begin
  for rec in
    select lat, lng, capturado_en
      from sgc.chofer_posiciones
     where usuario_id = p_uid
       and (capturado_en at time zone 'America/Santo_Domingo')::date = p_fecha
     order by capturado_en asc
  loop
    -- ¿nuevo tramo? (primer punto o hueco temporal grande)
    if v_pcap is null or rec.capturado_en - v_pcap > make_interval(mins => v_gap_min) then
      -- cerrar el tramo anterior si tenía >= 2 puntos
      if jsonb_array_length(v_seg) >= 2 then
        v_tramos := v_tramos || jsonb_build_array(jsonb_build_object(
          'inicio_at', v_seg_ini, 'fin_at', v_seg_fin,
          'km', round(v_seg_km, 2), 'coords', v_seg));
      end if;
      v_seg := '[]'::jsonb; v_seg_km := 0; v_plat := null; v_plng := null;
      v_seg_ini := rec.capturado_en;
    else
      -- downsample dentro del tramo
      if v_plat is not null and sgc.haversine_km(v_plat, v_plng, rec.lat, rec.lng) * 1000 < v_min_m then
        v_pcap := rec.capturado_en; v_seg_fin := rec.capturado_en; continue;
      end if;
      if v_plat is not null then
        v_seg_km := v_seg_km + sgc.haversine_km(v_plat, v_plng, rec.lat, rec.lng);
      end if;
    end if;

    v_seg := v_seg || jsonb_build_array(jsonb_build_array(rec.lat, rec.lng));
    v_seg_fin := rec.capturado_en;
    v_plat := rec.lat; v_plng := rec.lng; v_pcap := rec.capturado_en;
  end loop;

  -- cerrar el último tramo
  if jsonb_array_length(v_seg) >= 2 then
    v_tramos := v_tramos || jsonb_build_array(jsonb_build_object(
      'inicio_at', v_seg_ini, 'fin_at', v_seg_fin,
      'km', round(v_seg_km, 2), 'coords', v_seg));
  end if;

  return v_tramos;
end;
$$;
grant execute on function sgc._recorrido_tramos(uuid, date) to authenticated, service_role;

-- Consolidar (upsert permanente) el recorrido de un usuario en una fecha.
create or replace function sgc.consolidar_recorrido_diario(p_uid uuid, p_fecha date)
returns jsonb
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_tramos jsonb := sgc._recorrido_tramos(p_uid, p_fecha);
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
    (usuario_id, fecha, coords, polyline, tramos, puntos, km, primer_at, ultimo_at, consolidado_at)
  values
    (p_uid, p_fecha, v_coords, sgc.encode_polyline(v_coords), v_tramos,
     jsonb_array_length(v_coords), round(v_km,2), v_pri, v_ult, now())
  on conflict (usuario_id, fecha) do update
    set coords = excluded.coords, polyline = excluded.polyline, tramos = excluded.tramos,
        puntos = excluded.puntos, km = excluded.km,
        primer_at = excluded.primer_at, ultimo_at = excluded.ultimo_at,
        consolidado_at = now();

  return jsonb_build_object('usuario_id', p_uid, 'fecha', p_fecha,
                            'puntos', jsonb_array_length(v_coords), 'km', round(v_km,2));
end;
$$;
grant execute on function sgc.consolidar_recorrido_diario(uuid, date) to authenticated, service_role;

-- Lectura del recorrido diario (para la vista Timeline). Fecha pasada consolidada →
-- lee la tabla; hoy (o sin consolidar) → calcula en vivo desde los crudos.
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
  v_tramos jsonb; v_coords jsonb := '[]'::jsonb; v_km numeric := 0;
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
        'puntos', v_row.puntos, 'km', v_row.km,
        'primer_at', v_row.primer_at, 'ultimo_at', v_row.ultimo_at, 'fuente', 'consolidado');
    end if;
  end if;

  -- Hoy o sin consolidar → cálculo en vivo desde crudos.
  v_tramos := sgc._recorrido_tramos(p_usuario_id, p_fecha);
  for t in select * from jsonb_array_elements(v_tramos) loop
    v_coords := v_coords || (t->'coords');
    v_km := v_km + coalesce((t->>'km')::numeric, 0);
    if v_pri is null then v_pri := (t->>'inicio_at')::timestamptz; end if;
    v_ult := (t->>'fin_at')::timestamptz;
  end loop;

  return jsonb_build_object(
    'usuario_id', p_usuario_id, 'nombre', v_nombre, 'fecha', p_fecha,
    'coords', v_coords, 'polyline', sgc.encode_polyline(v_coords), 'tramos', v_tramos,
    'puntos', jsonb_array_length(v_coords), 'km', round(v_km,2),
    'primer_at', v_pri, 'ultimo_at', v_ult, 'fuente', 'vivo');
end;
$$;
grant execute on function sgc.recorrido_diario_de(uuid, date) to authenticated, service_role;

-- Directorio: qué usuarios tienen recorrido en un rango (para el selector de la vista).
-- Une crudos recientes (≤90d) + tabla consolidada (histórico permanente). Sharers only.
create or replace function sgc.recorridos_disponibles(p_desde date, p_hasta date)
returns table (usuario_id uuid, nombre text, fecha date, puntos bigint, km numeric)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with crudos as (
    select cp.usuario_id,
           (cp.capturado_en at time zone 'America/Santo_Domingo')::date as fecha,
           count(*) as puntos
      from sgc.chofer_posiciones cp
     where (cp.capturado_en at time zone 'America/Santo_Domingo')::date between p_desde and p_hasta
     group by 1, 2
  ),
  unidos as (
    select usuario_id, fecha, puntos, null::numeric as km from crudos
    union
    select rd.usuario_id, rd.fecha, rd.puntos::bigint, rd.km
      from sgc.recorrido_diario rd
     where rd.fecha between p_desde and p_hasta
  ),
  agg as (
    select usuario_id, fecha, max(puntos) as puntos, max(km) as km
      from unidos group by usuario_id, fecha
  )
  select a.usuario_id, u.nombre, a.fecha, a.puntos, a.km
    from agg a
    join sgc.usuarios u on u.id = a.usuario_id
   where sgc.comparte_ubicacion(a.usuario_id)
     and (sgc.is_admin() or sgc.es_flota_elevado() or a.usuario_id = auth.uid())
   order by a.fecha desc, u.nombre asc;
$$;
grant execute on function sgc.recorridos_disponibles(date, date) to authenticated, service_role;

-- Barrido nocturno: consolida el día anterior (RD) para todo el que reportó.
create or replace function sgc.consolidar_recorridos_del_dia(p_fecha date default null)
returns integer
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_fecha date := coalesce(p_fecha, ((now() at time zone 'America/Santo_Domingo')::date - 1));
  rec record; v_n int := 0;
begin
  for rec in
    select distinct usuario_id
      from sgc.chofer_posiciones
     where (capturado_en at time zone 'America/Santo_Domingo')::date = v_fecha
  loop
    perform sgc.consolidar_recorrido_diario(rec.usuario_id, v_fecha);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
grant execute on function sgc.consolidar_recorridos_del_dia(date) to authenticated, service_role;

-- Cron: consolidar ayer a las 3:50 (antes del purgado de crudos de las 4:30).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'sgc-consolidar-recorridos') then
    perform cron.schedule('sgc-consolidar-recorridos', '50 3 * * *',
      $cron$ select sgc.consolidar_recorridos_del_dia(); $cron$);
  end if;
end $$;
