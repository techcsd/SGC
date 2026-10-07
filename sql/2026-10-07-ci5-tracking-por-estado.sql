-- 2026-10-07-ci5-tracking-por-estado.sql
-- CI5 — El estado del chofer apaga la ingesta de GPS (requisito de tiendas + privacidad).
-- Reproduce la definición VIVA de registrar_posiciones (= av8) añadiendo el gate de estado,
-- y amplía mi_config_tracking con estado + rastrear (columnas AL FINAL, retrocompatible).
-- Aditivo. Gate SOLO sobre estado EXPLÍCITO 'inactivo' (no sobre ausencia de fila): así
-- el chofer_privado (CG6) y quien nunca tocó el selector NO cambian de comportamiento.
--   node scripts/apply-migration.mjs sql/2026-10-07-ci5-tracking-por-estado.sql --env dev

-- ── gps_ingesta_log: contador de descartados por estado inactivo ─────────────────
alter table sgc.gps_ingesta_log add column if not exists desc_inactivo int not null default 0;

-- ── registrar_posiciones (av8 + gate de estado) ──────────────────────────────────
create or replace function sgc.registrar_posiciones(p_posiciones jsonb)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
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
  v_estado text;                 -- CI5
  v_recibidos int;               -- CI5
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para registrar posición';
  end if;

  -- CI5 — si el chofer marcó EXPLÍCITAMENTE 'inactivo', descarta todo el lote.
  -- (Ausencia de fila = nunca usó el selector = NO se bloquea: no regresiona a
  -- chofer_privado ni a choferes nuevos.)
  select estado into v_estado from sgc.chofer_estado where usuario_id = v_uid;
  if v_estado = 'inactivo' then
    v_recibidos := jsonb_array_length(coalesce(p_posiciones, '[]'::jsonb));
    if v_recibidos > 0 then
      insert into sgc.gps_ingesta_log (usuario_id, recibidos, insertados, desc_inactivo)
      values (v_uid, v_recibidos, 0, v_recibidos);
    end if;
    return 0;
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
$function$;
grant execute on function sgc.registrar_posiciones(jsonb) to authenticated, service_role;

-- ── mi_config_tracking: + estado + rastrear (al final; retrocompatible) ──────────
-- rastrear = comparte Y NO está explícitamente inactivo. Ausencia de fila cuenta como
-- "no inactivo" (coalesce true) para no apagar al chofer_privado ni al recién llegado.
-- Cambia el tipo de retorno (añade OUT) → hay que soltar la función antes.
drop function if exists sgc.mi_config_tracking();
create or replace function sgc.mi_config_tracking()
returns table (
  comparte        boolean,
  distancia_m     integer,
  flush_seg       integer,
  precision_max_m integer,
  estado          text,
  rastrear        boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    sgc.comparte_ubicacion(auth.uid())                                                        as comparte,
    coalesce((select valor from sgc.parametros where clave='gps_distance_filter_m'),'25')::int as distancia_m,
    coalesce((select valor from sgc.parametros where clave='gps_flush_seg'),'45')::int         as flush_seg,
    coalesce((select valor from sgc.parametros where clave='gps_precision_max_m'),'200')::int  as precision_max_m,
    coalesce((select estado from sgc.chofer_estado where usuario_id = auth.uid()), 'inactivo') as estado,
    sgc.comparte_ubicacion(auth.uid())
      and coalesce((select estado from sgc.chofer_estado where usuario_id = auth.uid()) <> 'inactivo', true) as rastrear
$function$;
grant execute on function sgc.mi_config_tracking() to authenticated;

-- ── Auto-Inactivo por hora (apagado por defecto) ─────────────────────────────────
insert into sgc.parametros (clave, valor, descripcion) values
  ('tracking_auto_inactivo_hora', '', 'CI5 — hora (0-23, RD) a la que se marca Inactivo a los choferes que no estén en ruta. Vacío = apagado. Recomendado encenderlo (ej. 21).')
on conflict (clave) do nothing;

create or replace function sgc.auto_inactivar_por_hora()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_hora_param text := nullif(trim((select valor from sgc.parametros where clave='tracking_auto_inactivo_hora')), '');
  v_hora_rd int := extract(hour from (now() at time zone 'America/Santo_Domingo'))::int;
  v_n int := 0;
  r record;
begin
  if v_hora_param is null then return 0; end if;                 -- apagado
  if v_hora_rd <> v_hora_param::int then return 0; end if;       -- solo a la hora configurada
  for r in
    select usuario_id from sgc.chofer_estado
    where estado not in ('inactivo','en_ruta')
  loop
    perform sgc._set_chofer_estado(r.usuario_id, 'inactivo', null, 'auto');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
grant execute on function sgc.auto_inactivar_por_hora() to service_role;

-- Cron cada hora (en punto, UTC). La función no hace nada mientras el parámetro esté vacío.
select cron.schedule('auto-inactivar-choferes', '0 * * * *', $cron$ select sgc.auto_inactivar_por_hora(); $cron$);
