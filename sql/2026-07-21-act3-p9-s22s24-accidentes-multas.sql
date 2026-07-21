-- ============================================================================
-- Actualización 3 · PROMPT-9 · S22 + S24 — Accidentes, daños y multas.
--   vehiculo_accidentes (con acta AMET), vehiculo_danos (fuera de entregas) y
--   conductor_multas. RLS R14 (chofer ve/inserta lo suyo; elevados todo).
--   RPCs *_app idempotentes para captura offline desde la app.
--   Documentos (AMET/multa) van al bucket flota-documentos (path directo).
-- Aditivo / idempotente / retrocompatible.
-- ============================================================================
set search_path = sgc, public;

-- ── S22) Accidentes ─────────────────────────────────────────────────────────
create table if not exists sgc.vehiculo_accidentes (
  id                 uuid primary key default gen_random_uuid(),
  vehiculo_id        uuid not null references sgc.vehiculos(id) on delete cascade,
  conductor_id       uuid references sgc.conductores(id) on delete set null,
  fecha              date not null default current_date,
  fase               text not null default 'en_el_momento' check (fase in ('en_el_momento','posterior')),
  descripcion        text,
  lesionados         smallint not null default 0,
  tercero_involucrado text,
  ubicacion_lat      numeric,
  ubicacion_lng      numeric,
  reporte_amet_path  text,      -- documento del acta AMET (bucket flota-documentos)
  creado_por         uuid,
  creado_en          timestamptz not null default now()
);
create index if not exists idx_vehiculo_accidentes_vehiculo on sgc.vehiculo_accidentes(vehiculo_id);
create index if not exists idx_vehiculo_accidentes_conductor on sgc.vehiculo_accidentes(conductor_id);

-- ── S22) Daños (fuera de entregas) ──────────────────────────────────────────
create table if not exists sgc.vehiculo_danos (
  id            uuid primary key default gen_random_uuid(),
  vehiculo_id   uuid not null references sgc.vehiculos(id) on delete cascade,
  zona          text,
  descripcion   text,
  foto_path     text,
  origen        text not null default 'desconocido' check (origen in ('accidente','uso','desconocido')),
  accidente_id  uuid references sgc.vehiculo_accidentes(id) on delete set null,
  reportado_por uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_vehiculo_danos_vehiculo on sgc.vehiculo_danos(vehiculo_id);

-- ── S24) Multas de conductores ──────────────────────────────────────────────
create table if not exists sgc.conductor_multas (
  id             uuid primary key default gen_random_uuid(),
  conductor_id   uuid not null references sgc.conductores(id) on delete cascade,
  fecha          date not null default current_date,
  motivo         text,
  monto          numeric,
  vehiculo_id    uuid references sgc.vehiculos(id) on delete set null,
  accidente_id   uuid references sgc.vehiculo_accidentes(id) on delete set null,
  documento_path text,
  estado         text not null default 'pendiente' check (estado in ('pendiente','pagada')),
  registrado_por uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_conductor_multas_conductor on sgc.conductor_multas(conductor_id);

-- ── RLS (patrón R14) ────────────────────────────────────────────────────────
alter table sgc.vehiculo_accidentes enable row level security;
alter table sgc.vehiculo_danos      enable row level security;
alter table sgc.conductor_multas    enable row level security;

-- Accidentes: elevados todo; chofer los suyos (por conductor vinculado).
drop policy if exists va_select on sgc.vehiculo_accidentes;
create policy va_select on sgc.vehiculo_accidentes for select to authenticated using (
  sgc.es_flota_elevado()
  or conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
);
drop policy if exists va_insert on sgc.vehiculo_accidentes;
create policy va_insert on sgc.vehiculo_accidentes for insert to authenticated with check (
  sgc.es_flota_elevado() or creado_por = auth.uid()
);
drop policy if exists va_write on sgc.vehiculo_accidentes;
create policy va_write on sgc.vehiculo_accidentes for update to authenticated
  using (sgc.es_flota_elevado()) with check (sgc.es_flota_elevado());
drop policy if exists va_delete on sgc.vehiculo_accidentes;
create policy va_delete on sgc.vehiculo_accidentes for delete to authenticated using (sgc.es_flota_elevado());

-- Daños: elevados todo; el reportante ve/insertan lo suyo.
drop policy if exists vd_select on sgc.vehiculo_danos;
create policy vd_select on sgc.vehiculo_danos for select to authenticated using (
  sgc.es_flota_elevado() or reportado_por = auth.uid()
);
drop policy if exists vd_insert on sgc.vehiculo_danos;
create policy vd_insert on sgc.vehiculo_danos for insert to authenticated with check (
  sgc.es_flota_elevado() or reportado_por = auth.uid()
);
drop policy if exists vd_write on sgc.vehiculo_danos;
create policy vd_write on sgc.vehiculo_danos for update to authenticated
  using (sgc.es_flota_elevado()) with check (sgc.es_flota_elevado());
drop policy if exists vd_delete on sgc.vehiculo_danos;
create policy vd_delete on sgc.vehiculo_danos for delete to authenticated using (sgc.es_flota_elevado());

-- Multas: elevados todo; chofer ve/inserta las suyas (no puede editarlas).
drop policy if exists cm_select on sgc.conductor_multas;
create policy cm_select on sgc.conductor_multas for select to authenticated using (
  sgc.es_flota_elevado()
  or conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
);
drop policy if exists cm_insert on sgc.conductor_multas;
create policy cm_insert on sgc.conductor_multas for insert to authenticated with check (
  sgc.es_flota_elevado()
  or conductor_id in (select id from sgc.conductores where usuario_id = auth.uid())
);
drop policy if exists cm_write on sgc.conductor_multas;
create policy cm_write on sgc.conductor_multas for update to authenticated
  using (sgc.es_flota_elevado()) with check (sgc.es_flota_elevado());
drop policy if exists cm_delete on sgc.conductor_multas;
create policy cm_delete on sgc.conductor_multas for delete to authenticated using (sgc.es_flota_elevado());

grant usage on schema sgc to authenticated;
grant select, insert, update, delete on sgc.vehiculo_accidentes, sgc.vehiculo_danos, sgc.conductor_multas to authenticated;
grant all on sgc.vehiculo_accidentes, sgc.vehiculo_danos, sgc.conductor_multas to service_role;

do $$ begin
  alter publication supabase_realtime add table sgc.vehiculo_accidentes;
  alter publication supabase_realtime add table sgc.vehiculo_danos;
  alter publication supabase_realtime add table sgc.conductor_multas;
exception when duplicate_object then null; end $$;

-- ── RPCs *_app (captura offline, idempotentes por id de cliente) ────────────
create or replace function sgc.registrar_accidente_app(
  p_id uuid, p_vehiculo_id uuid, p_fecha date, p_fase text,
  p_descripcion text default null, p_lesionados smallint default 0,
  p_tercero text default null, p_conductor_id uuid default null,
  p_gps jsonb default null, p_reporte_amet_path text default null,
  p_capturado_en timestamptz default now()
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_uid uuid := auth.uid(); v_cond uuid := p_conductor_id;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.vehiculo_accidentes where id = p_id) then return p_id; end if;
  -- Si no se pasó conductor, intenta el conductor vinculado al usuario.
  if v_cond is null then
    select id into v_cond from sgc.conductores where usuario_id = v_uid limit 1;
  end if;
  insert into sgc.vehiculo_accidentes (
    id, vehiculo_id, conductor_id, fecha, fase, descripcion, lesionados,
    tercero_involucrado, ubicacion_lat, ubicacion_lng, reporte_amet_path, creado_por, creado_en
  ) values (
    p_id, p_vehiculo_id, v_cond, coalesce(p_fecha, current_date),
    coalesce(p_fase,'en_el_momento'), p_descripcion, coalesce(p_lesionados,0),
    nullif(trim(p_tercero),''),
    nullif(p_gps->>'lat','')::numeric, nullif(p_gps->>'lng','')::numeric,
    nullif(trim(p_reporte_amet_path),''), v_uid, coalesce(p_capturado_en, now())
  );
  return p_id;
end;
$$;
grant execute on function sgc.registrar_accidente_app(uuid,uuid,date,text,text,smallint,text,uuid,jsonb,text,timestamptz) to authenticated, service_role;

create or replace function sgc.registrar_dano_app(
  p_id uuid, p_vehiculo_id uuid, p_zona text default null, p_descripcion text default null,
  p_foto_path text default null, p_origen text default 'desconocido',
  p_accidente_id uuid default null, p_capturado_en timestamptz default now()
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.vehiculo_danos where id = p_id) then return p_id; end if;
  insert into sgc.vehiculo_danos (id, vehiculo_id, zona, descripcion, foto_path, origen, accidente_id, reportado_por)
  values (p_id, p_vehiculo_id, nullif(trim(p_zona),''), nullif(trim(p_descripcion),''),
          nullif(trim(p_foto_path),''),
          case when p_origen in ('accidente','uso','desconocido') then p_origen else 'desconocido' end,
          p_accidente_id, v_uid);
  return p_id;
end;
$$;
grant execute on function sgc.registrar_dano_app(uuid,uuid,text,text,text,text,uuid,timestamptz) to authenticated, service_role;

create or replace function sgc.registrar_multa_app(
  p_id uuid, p_conductor_id uuid, p_fecha date, p_motivo text default null,
  p_monto numeric default null, p_vehiculo_id uuid default null, p_accidente_id uuid default null,
  p_documento_path text default null, p_estado text default 'pendiente',
  p_capturado_en timestamptz default now()
) returns uuid
language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.tiene_modulo('flota') or sgc.is_admin()
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;
  if exists (select 1 from sgc.conductor_multas where id = p_id) then return p_id; end if;
  insert into sgc.conductor_multas (id, conductor_id, fecha, motivo, monto, vehiculo_id, accidente_id, documento_path, estado, registrado_por)
  values (p_id, p_conductor_id, coalesce(p_fecha, current_date), nullif(trim(p_motivo),''), p_monto,
          p_vehiculo_id, p_accidente_id, nullif(trim(p_documento_path),''),
          case when p_estado in ('pendiente','pagada') then p_estado else 'pendiente' end, v_uid);
  return p_id;
end;
$$;
grant execute on function sgc.registrar_multa_app(uuid,uuid,date,text,numeric,uuid,uuid,text,text,timestamptz) to authenticated, service_role;
