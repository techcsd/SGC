-- =============================================================================
-- PROMPT-1 FASE 7 (AK2 + AK13) — Layout por scope + diagnóstico de tracking.
-- SGC padre. Aditivo, retrocompatible.
--
-- AK2: el layout (orden + tamaño de tiles) hoy es global del launcher (home). Se
--   amplía con SCOPE por pantalla (home + cada módulo/submódulo con su propio grid).
--   PK pasa a (scope, clave). Permiso delegable 'plataforma.layout_app' intacto.
--
-- AK13 (re-reporte, tracking roto): se instrumenta la ingesta para ubicar el eslabón
--   roto (recibidos/insertados/descartados por sesión) y se corrige lo server-side:
--   (a) guard ampliado (no rechaza al user test), (b) es_prueba en los puntos.
-- =============================================================================

begin;

-- ══════════════════════ AK2 — Layout por scope ══════════════════════════════
alter table sgc.app_module_order add column if not exists scope text not null default 'home';
comment on column sgc.app_module_order.scope is 'AK2 — pantalla a la que pertenece el tile: home | <clave de módulo/submódulo>.';

-- Re-armar la PK a (scope, clave) de forma idempotente.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'app_module_order_pkey'
             and conrelid = 'sgc.app_module_order'::regclass) then
    alter table sgc.app_module_order drop constraint app_module_order_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_module_order_scope_clave_pk'
             and conrelid = 'sgc.app_module_order'::regclass) then
    alter table sgc.app_module_order add constraint app_module_order_scope_clave_pk primary key (scope, clave);
  end if;
end $$;

-- Lecturas/escrituras con scope (retrocompat: sin arg → home).
drop function if exists sgc.get_module_order();
create or replace function sgc.get_module_order(p_scope text default 'home')
returns setof sgc.app_module_order
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select * from sgc.app_module_order
  where p_scope is null or scope = p_scope
  order by scope, parent nulls first, orden;
$$;
grant execute on function sgc.get_module_order(text) to authenticated, service_role;

drop function if exists sgc.set_module_order(jsonb);
create or replace function sgc.set_module_order(p_items jsonb, p_scope text default 'home')
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid(); it jsonb; v_size text; v_scope text := coalesce(nullif(p_scope,''),'home');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.puede_operar_submodulo('plataforma.layout_app')) then
    raise exception 'No tienes permiso para personalizar el layout de la app.';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_size := lower(coalesce(nullif(it->>'size',''), '1x1'));
    if v_size not in ('1x1','2x1','2x2') then v_size := '1x1'; end if;
    insert into sgc.app_module_order (scope, clave, parent, orden, size, updated_at, updated_by)
    values (coalesce(nullif(it->>'scope',''), v_scope), it->>'clave', nullif(it->>'parent',''),
            coalesce((it->>'orden')::int, 0), v_size, now(), v_uid)
    on conflict (scope, clave) do update
      set parent = excluded.parent, orden = excluded.orden, size = excluded.size,
          updated_at = now(), updated_by = v_uid;
  end loop;
end;
$$;
grant execute on function sgc.set_module_order(jsonb, text) to authenticated, service_role;

-- ══════════════════════ AK13 — Diagnóstico de tracking ══════════════════════
-- Log de ingesta por batch (telemetría de huecos Y6): recibidos vs insertados vs
-- descartados por motivo. Append-only; se agrega por ruta/usuario/día.
create table if not exists sgc.gps_ingesta_log (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null,
  ruta_id        uuid,
  recibidos      int not null default 0,
  insertados     int not null default 0,
  desc_precision int not null default 0,
  desc_salto     int not null default 0,
  desc_sin_coord int not null default 0,
  es_prueba      boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists ix_gps_ingesta_log_usuario on sgc.gps_ingesta_log(usuario_id, created_at desc);
create index if not exists ix_gps_ingesta_log_ruta on sgc.gps_ingesta_log(ruta_id, created_at desc);
alter table sgc.gps_ingesta_log enable row level security;
drop policy if exists gps_ingesta_log_read on sgc.gps_ingesta_log;
create policy gps_ingesta_log_read on sgc.gps_ingesta_log for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia());
grant select on sgc.gps_ingesta_log to authenticated, service_role;

-- Ingesta instrumentada: cuenta motivos, setea es_prueba y amplía el guard.
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
  v_lat numeric; v_lng numeric; v_prec numeric; v_cap timestamptz; v_ruta uuid; v_veh uuid;
  v_plat numeric; v_plng numeric; v_pcap timestamptz; v_dist numeric; v_dt numeric; v_speed numeric;
  -- AK13 — contadores de diagnóstico
  v_recibidos int := 0; v_desc_prec int := 0; v_desc_salto int := 0; v_desc_coord int := 0;
  v_ruta_log uuid; v_esp boolean := false; v_veh_prev uuid; v_esp_prev boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  -- Guard AMPLIADO (AK13): no rechazar al usuario de prueba / conductor por sesión de uso.
  if not (sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.es_conductor_ampliado(v_uid)) then
    raise exception 'Sin permiso para registrar posición';
  end if;

  select lat, lng, capturado_en into v_plat, v_plng, v_pcap
    from sgc.chofer_posiciones where usuario_id = v_uid
    order by capturado_en desc limit 1;

  for it in select * from jsonb_array_elements(coalesce(p_posiciones, '[]'::jsonb))
  loop
    v_recibidos := v_recibidos + 1;
    if (it->>'lat') is null or (it->>'lng') is null then v_desc_coord := v_desc_coord + 1; continue; end if;
    v_lat  := (it->>'lat')::numeric;
    v_lng  := (it->>'lng')::numeric;
    v_prec := nullif(it->>'precision','')::numeric;
    v_cap  := coalesce(nullif(it->>'capturado_en','')::timestamptz, now());
    v_ruta := nullif(it->>'ruta_id','')::uuid;
    v_veh  := nullif(it->>'vehiculo_id','')::uuid;
    if v_ruta is not null then v_ruta_log := v_ruta; end if;

    if v_prec is not null and v_prec > v_prec_max then v_desc_prec := v_desc_prec + 1; continue; end if;

    if v_plat is not null and v_pcap is not null and v_cap > v_pcap then
      v_dist  := sgc.haversine_km(v_plat, v_plng, v_lat, v_lng);
      v_dt    := extract(epoch from (v_cap - v_pcap)) / 3600.0;
      if v_dt > 0 then
        v_speed := v_dist / v_dt;
        if v_speed > v_vel_max then v_desc_salto := v_desc_salto + 1; continue; end if;
      end if;
    end if;

    -- es_prueba del punto: heredado del vehículo (cache por cambio de vehículo).
    if v_veh is distinct from v_veh_prev then
      v_esp_prev := coalesce((select v.es_prueba from sgc.vehiculos v where v.id = v_veh), false);
      v_veh_prev := v_veh;
    end if;
    v_esp := v_esp_prev;

    insert into sgc.chofer_posiciones (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en, ruta_id, es_prueba)
    values (v_uid, v_veh, v_lat, v_lng, v_prec, nullif(it->>'bateria','')::int, v_cap, v_ruta, v_esp);
    v_n := v_n + 1;
    v_plat := v_lat; v_plng := v_lng; v_pcap := v_cap;

    if v_last_cap is null or v_cap >= v_last_cap then v_last_cap := v_cap; v_last := it; end if;
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

  -- AK13 — telemetría de la sesión (solo si llegó algo, para no ensuciar).
  if v_recibidos > 0 then
    insert into sgc.gps_ingesta_log (usuario_id, ruta_id, recibidos, insertados, desc_precision, desc_salto, desc_sin_coord, es_prueba)
    values (v_uid, v_ruta_log, v_recibidos, v_n, v_desc_prec, v_desc_salto, v_desc_coord, v_esp);
  end if;

  return v_n;
end;
$function$;
grant execute on function sgc.registrar_posiciones(jsonb) to authenticated, service_role;

-- Diagnóstico agregado (telemetría Y6): recibidos/insertados/descartados por periodo.
create or replace function sgc.gps_ingesta_diagnostico(
  p_usuario_id uuid default null,
  p_ruta_id    uuid default null,
  p_desde      timestamptz default null
)
returns table (usuario_id uuid, usuario_nombre text, batches int, recibidos bigint, insertados bigint,
               desc_precision bigint, desc_salto bigint, desc_sin_coord bigint, ultima timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select g.usuario_id, u.nombre::text, count(*)::int,
         sum(g.recibidos), sum(g.insertados), sum(g.desc_precision), sum(g.desc_salto), sum(g.desc_sin_coord),
         max(g.created_at)
  from sgc.gps_ingesta_log g
  left join sgc.usuarios u on u.id = g.usuario_id
  where (sgc.is_admin() or sgc.es_flota_elevado() or sgc.es_tecnologia() or g.usuario_id = auth.uid())
    and (p_usuario_id is null or g.usuario_id = p_usuario_id)
    and (p_ruta_id is null or g.ruta_id = p_ruta_id)
    and (p_desde is null or g.created_at >= p_desde)
  group by g.usuario_id, u.nombre
  order by max(g.created_at) desc;
$$;
grant execute on function sgc.gps_ingesta_diagnostico(uuid, uuid, timestamptz) to authenticated, service_role;

commit;
