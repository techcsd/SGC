-- ============================================================================
-- TRANSPORTE v2 — FASE 2 — Rutas vivas + historial (AF25, AF24, AF29)
-- Ronda 03/08/2026 (IDs AF) — PROMPT-3. Doc: TRANSPORTE-V2.md (aprobado).
--
--   - ruta_eventos: historial inmutable (parada agregada, destino cambiado…).
--   - RPCs: agregar_parada_ruta, cambiar_destino_ruta (cancelar = cambiar destino).
--   - ruta.documento_path (adjunta jefe de flota/admin).
--   - rutas_activas_y_hoy(): listado activas-primero + de hoy.
--
-- Aditivo, idempotente, retrocompatible.
-- ============================================================================

-- ── Documento adjunto a la ruta (AF24: solo jefe de flota/admin) ────────────
alter table sgc.rutas add column if not exists documento_path text;
comment on column sgc.rutas.documento_path is 'AF24 — documento adjunto (ej. factura); lo sube jefe de flota/admin. Bucket vehiculos.';

-- ── Historial inmutable de modificaciones de ruta ───────────────────────────
create table if not exists sgc.ruta_eventos (
  id         uuid primary key default gen_random_uuid(),
  ruta_id    uuid not null references sgc.rutas(id) on delete cascade,
  tipo       text not null check (tipo in ('parada_agregada','destino_cambiado','parada_omitida','iniciada','finalizada','documento_adjunto')),
  detalle    text,
  lat        numeric(9,6),
  lng        numeric(9,6),
  por        uuid references sgc.usuarios(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_ruta_eventos_ruta on sgc.ruta_eventos (ruta_id, created_at desc);

alter table sgc.ruta_eventos enable row level security;
drop policy if exists "ruta_eventos: read" on sgc.ruta_eventos;
create policy "ruta_eventos: read" on sgc.ruta_eventos
  for select to authenticated
  using (
    exists (select 1 from sgc.rutas r where r.id = ruta_id
            and (sgc.es_flota_elevado() or r.creado_por = auth.uid()
                 or r.conductor_id in (select sgc.mis_conductor_ids())))
  );
grant select on sgc.ruta_eventos to authenticated;
grant all on sgc.ruta_eventos to service_role;

-- helper interno para registrar un evento (usado por los RPCs de abajo)
create or replace function sgc._log_ruta_evento(p_ruta_id uuid, p_tipo text, p_detalle text, p_lat numeric, p_lng numeric)
returns void
language sql security definer
set search_path to 'sgc', 'pg_temp'
as $$
  insert into sgc.ruta_eventos (ruta_id, tipo, detalle, lat, lng, por)
  values (p_ruta_id, p_tipo, p_detalle, p_lat, p_lng, auth.uid());
$$;

-- ── Guard reutilizable: ¿puede el usuario modificar esta ruta? ──────────────
create or replace function sgc.puede_modificar_ruta(p_ruta_id uuid)
returns boolean
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select exists (select 1 from sgc.rutas r where r.id = p_ruta_id
    and (sgc.es_flota_elevado() or sgc.tiene_modulo('flota') or r.creado_por = auth.uid()
         or r.conductor_id in (select sgc.mis_conductor_ids())));
$$;
grant execute on function sgc.puede_modificar_ruta(uuid) to authenticated, service_role;

-- ── AF25 — Agregar una parada a mitad de ruta ───────────────────────────────
create or replace function sgc.agregar_parada_ruta(
  p_ruta_id uuid, p_ubicacion text, p_proyecto_id uuid default null,
  p_lat numeric default null, p_lng numeric default null, p_notas text default null)
returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_orden int; v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_modificar_ruta(p_ruta_id) then raise exception 'No autorizado para modificar esta ruta'; end if;
  if coalesce(trim(p_ubicacion),'') = '' then raise exception 'La parada necesita una ubicación'; end if;
  select coalesce(max(orden),0)+1 into v_orden from sgc.ruta_paradas where ruta_id = p_ruta_id;
  insert into sgc.ruta_paradas (ruta_id, orden, ubicacion, proyecto_id, lat, lng, notas, estado)
  values (p_ruta_id, v_orden, p_ubicacion, p_proyecto_id, p_lat, p_lng, p_notas, 'pendiente')
  returning id into v_id;
  perform sgc._log_ruta_evento(p_ruta_id, 'parada_agregada', p_ubicacion, p_lat, p_lng);
  return v_id;
end;
$$;
grant execute on function sgc.agregar_parada_ruta(uuid, text, uuid, numeric, numeric, text) to authenticated, service_role;

-- ── AF25 — Cambiar destino (NO cancelar: el destino cambia y se trackea) ────
create or replace function sgc.cambiar_destino_ruta(
  p_ruta_id uuid, p_destino text, p_proyecto_id uuid default null,
  p_lat numeric default null, p_lng numeric default null)
returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_antes text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.puede_modificar_ruta(p_ruta_id) then raise exception 'No autorizado para modificar esta ruta'; end if;
  if coalesce(trim(p_destino),'') = '' then raise exception 'Falta el nuevo destino'; end if;
  select destino into v_antes from sgc.rutas where id = p_ruta_id;
  update sgc.rutas
     set destino = p_destino,
         destino_proyecto_id = coalesce(p_proyecto_id, destino_proyecto_id),
         destino_lat = coalesce(p_lat, destino_lat),
         destino_lng = coalesce(p_lng, destino_lng),
         updated_at = now()
   where id = p_ruta_id;
  perform sgc._log_ruta_evento(p_ruta_id, 'destino_cambiado',
    format('%s → %s', coalesce(v_antes,'—'), p_destino), p_lat, p_lng);
end;
$$;
grant execute on function sgc.cambiar_destino_ruta(uuid, text, uuid, numeric, numeric) to authenticated, service_role;

-- ── AF25/AF29 — Listado "Rutas activas" + "Rutas de hoy" (activas primero) ──
create or replace function sgc.rutas_activas_y_hoy()
returns table (
  id                 uuid,
  seccion            text,        -- 'activa' | 'hoy'
  estado             text,
  tipo               text,
  origen             text,
  destino            text,
  placa              text,
  conductor_nombre   text,
  fecha              date,
  iniciada_at        timestamptz,
  paradas_total      int,
  paradas_entregadas int
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    r.id,
    case when r.estado = 'en_curso' then 'activa' else 'hoy' end as seccion,
    r.estado, r.tipo, r.origen, r.destino, v.placa, c.nombre, r.fecha, r.iniciada_at,
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id),
    (select count(*)::int from sgc.ruta_paradas p where p.ruta_id = r.id and p.estado = 'entregada')
  from sgc.rutas r
  left join sgc.vehiculos v on v.id = r.vehiculo_id
  left join sgc.conductores c on c.id = r.conductor_id
  where (sgc.es_flota_elevado() or r.creado_por = auth.uid() or r.conductor_id in (select sgc.mis_conductor_ids()))
    and (r.estado = 'en_curso' or r.fecha = current_date)
  order by (case when r.estado = 'en_curso' then 0 else 1 end), r.iniciada_at desc nulls last, r.fecha desc;
$$;
grant execute on function sgc.rutas_activas_y_hoy() to authenticated, service_role;
