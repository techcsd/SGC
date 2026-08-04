-- ============================================================================
-- TRANSPORTE v2 — FASE 4 — Tracking en tiempo real (AF26, AF27)
-- Ronda 03/08/2026 (IDs AF) — PROMPT-3. Doc: TRANSPORTE-V2.md (aprobado).
--
--   - chofer_posiciones: breadcrumb (retención 7 días vía cron).
--   - chofer_ultima_posicion: última posición por usuario (para el mapa + realtime).
--   - registrar_posiciones(jsonb): ingesta batch (la app manda lotes offline-first).
--   - gps_eventos: lapsos sin señal / GPS apagado (AF26 + auditoría).
--   - RLS: el chofer escribe SOLO la suya; leen jefe de flota/admin/tecnología.
--
-- Aditivo, idempotente. Escritura vía RPC SECURITY DEFINER.
-- ============================================================================

-- ── Breadcrumb ──────────────────────────────────────────────────────────────
create table if not exists sgc.chofer_posiciones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references sgc.usuarios(id) on delete cascade,
  vehiculo_id  uuid references sgc.vehiculos(id) on delete set null,
  lat          numeric(9,6) not null,
  lng          numeric(9,6) not null,
  precision_m  numeric,
  bateria      int,
  capturado_en timestamptz not null default now(),
  es_prueba    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_chofer_posiciones_user_time on sgc.chofer_posiciones (usuario_id, capturado_en desc);

-- ── Última posición por usuario (para el mapa + realtime) ───────────────────
create table if not exists sgc.chofer_ultima_posicion (
  usuario_id   uuid primary key references sgc.usuarios(id) on delete cascade,
  vehiculo_id  uuid references sgc.vehiculos(id) on delete set null,
  lat          numeric(9,6) not null,
  lng          numeric(9,6) not null,
  precision_m  numeric,
  bateria      int,
  capturado_en timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Eventos de GPS (lapsos sin señal / apagado) ─────────────────────────────
create table if not exists sgc.gps_eventos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references sgc.usuarios(id) on delete cascade,
  tipo        text not null check (tipo in ('gps_apagado','gps_reactivado','permiso_revocado','operando_sin_gps')),
  detalle     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gps_eventos_user on sgc.gps_eventos (usuario_id, created_at desc);

alter table sgc.chofer_posiciones      enable row level security;
alter table sgc.chofer_ultima_posicion enable row level security;
alter table sgc.gps_eventos            enable row level security;

-- Lectura: jefe de flota/admin/tecnología, o el propio chofer (su rastro).
drop policy if exists "chofer_posiciones: read" on sgc.chofer_posiciones;
create policy "chofer_posiciones: read" on sgc.chofer_posiciones
  for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_flota_elevado() or sgc.es_tecnologia());

drop policy if exists "chofer_ultima_posicion: read" on sgc.chofer_ultima_posicion;
create policy "chofer_ultima_posicion: read" on sgc.chofer_ultima_posicion
  for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_flota_elevado() or sgc.es_tecnologia());

drop policy if exists "gps_eventos: read" on sgc.gps_eventos;
create policy "gps_eventos: read" on sgc.gps_eventos
  for select to authenticated
  using (usuario_id = auth.uid() or sgc.es_flota_elevado() or sgc.es_tecnologia());

grant select on sgc.chofer_posiciones      to authenticated;
grant select on sgc.chofer_ultima_posicion to authenticated;
grant select on sgc.gps_eventos            to authenticated;
grant all on sgc.chofer_posiciones      to service_role;
grant all on sgc.chofer_ultima_posicion to service_role;
grant all on sgc.gps_eventos            to service_role;

-- ── Ingesta batch de posiciones (la app manda lotes) ────────────────────────
-- p_posiciones: [{lat,lng,precision,bateria,capturado_en,vehiculo_id}]
create or replace function sgc.registrar_posiciones(p_posiciones jsonb)
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  it jsonb; v_n int := 0;
  v_last_cap timestamptz; v_last jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  -- Solo choferes o flota registran posición.
  if not (sgc.tiene_modulo('flota') or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para registrar posición';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_posiciones, '[]'::jsonb))
  loop
    if (it->>'lat') is null or (it->>'lng') is null then continue; end if;
    insert into sgc.chofer_posiciones (usuario_id, vehiculo_id, lat, lng, precision_m, bateria, capturado_en)
    values (v_uid, nullif(it->>'vehiculo_id','')::uuid,
            (it->>'lat')::numeric, (it->>'lng')::numeric,
            nullif(it->>'precision','')::numeric, nullif(it->>'bateria','')::int,
            coalesce(nullif(it->>'capturado_en','')::timestamptz, now()));
    v_n := v_n + 1;
    if v_last_cap is null or coalesce(nullif(it->>'capturado_en','')::timestamptz, now()) >= v_last_cap then
      v_last_cap := coalesce(nullif(it->>'capturado_en','')::timestamptz, now());
      v_last := it;
    end if;
  end loop;

  -- Upsert de la última posición (la más reciente del lote).
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

-- ── Registrar un evento de GPS (apagado/reactivado/…) ───────────────────────
create or replace function sgc.registrar_gps_evento(p_tipo text, p_detalle text default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_tipo not in ('gps_apagado','gps_reactivado','permiso_revocado','operando_sin_gps') then
    raise exception 'Tipo de evento inválido: %', p_tipo;
  end if;
  insert into sgc.gps_eventos (usuario_id, tipo, detalle) values (v_uid, p_tipo, p_detalle);
end;
$$;
grant execute on function sgc.registrar_gps_evento(text, text) to authenticated, service_role;

-- ── Realtime en la última posición (para el mapa vivo del Seguimiento) ──────
do $$ begin
  alter publication supabase_realtime add table sgc.chofer_ultima_posicion;
exception when duplicate_object then null; when others then null; end $$;

-- ── Retención: purga el breadcrumb > 7 días (cron diario) ───────────────────
create or replace function sgc.purgar_posiciones_viejas()
returns integer
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_n int;
begin
  delete from sgc.chofer_posiciones where capturado_en < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function sgc.purgar_posiciones_viejas() to service_role;

do $$ begin perform cron.unschedule('sgc-purgar-posiciones'); exception when others then null; end $$;
select cron.schedule('sgc-purgar-posiciones', '30 4 * * *', $cron$ select sgc.purgar_posiciones_viejas(); $cron$);
