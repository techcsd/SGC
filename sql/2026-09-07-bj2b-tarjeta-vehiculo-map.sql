-- ============================================================================
-- BJ2 (parte b) — Mapa TARJETA → vehículo/persona, "se aprende una vez".
--
-- En la factura PDF de TotalEnergies el consumo suele estar a nombre de una
-- PERSONA (ING. RAUL RUIZ…), no de una placa → el matcher (por placa) lo mandaba
-- todo a `solo_informe`. El código de 4 dígitos de la tarjeta es la LLAVE ESTABLE.
-- Con este mapa, la conciliación resuelve tarjeta→vehículo antes de cruzar, y el
-- mapeo se recuerda para las próximas facturas.
--
-- Reglas del checklist: (1) tabla nueva con RLS ⇒ camino de escritura por rol
-- (RPC SECURITY DEFINER gated por es_flota_elevado); (2) es_persona NOT NULL nace
-- con default. Aditivo/idempotente.
-- ============================================================================

begin;
set local search_path = sgc, public;

create table if not exists sgc.combustible_tarjeta_map (
  codigo_tarjeta text primary key,
  vehiculo_id    uuid references sgc.vehiculos(id) on delete set null,
  titular_nombre text,
  es_persona     boolean not null default false,
  usuario_id     uuid references sgc.usuarios(id) on delete set null,
  notas          text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references sgc.usuarios(id)
);

alter table sgc.combustible_tarjeta_map enable row level security;

drop policy if exists "tarjeta_map: select" on sgc.combustible_tarjeta_map;
create policy "tarjeta_map: select" on sgc.combustible_tarjeta_map
  for select to authenticated using (sgc.es_flota_elevado());

grant select on sgc.combustible_tarjeta_map to authenticated;
grant all on sgc.combustible_tarjeta_map to service_role;

-- Listado con la placa del vehículo (para la UI de conciliación).
create or replace function sgc.combustible_tarjeta_map_listar()
returns table(
  codigo_tarjeta text, vehiculo_id uuid, placa text, titular_nombre text,
  es_persona boolean, usuario_id uuid, notas text)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select m.codigo_tarjeta, m.vehiculo_id, v.placa::text, m.titular_nombre,
         m.es_persona, m.usuario_id, m.notas
  from sgc.combustible_tarjeta_map m
  left join sgc.vehiculos v on v.id = m.vehiculo_id
  where sgc.es_flota_elevado();
$$;
grant execute on function sgc.combustible_tarjeta_map_listar() to authenticated, service_role;

-- Upsert del mapeo de una tarjeta (aprende/actualiza). Gate por rol flota-elevado.
create or replace function sgc.combustible_tarjeta_map_set(
  p_codigo text, p_vehiculo_id uuid default null, p_titular text default null,
  p_es_persona boolean default false, p_usuario_id uuid default null, p_notas text default null)
returns void
language plpgsql volatile security definer
set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not sgc.es_flota_elevado() then
    raise exception 'No autorizado para mapear tarjetas de combustible.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_codigo, '')), '') is null then
    raise exception 'El código de la tarjeta es obligatorio.';
  end if;
  insert into sgc.combustible_tarjeta_map
    (codigo_tarjeta, vehiculo_id, titular_nombre, es_persona, usuario_id, notas, updated_at, updated_by)
  values
    (btrim(p_codigo), p_vehiculo_id, nullif(btrim(coalesce(p_titular, '')), ''),
     coalesce(p_es_persona, false), p_usuario_id, nullif(btrim(coalesce(p_notas, '')), ''),
     now(), auth.uid())
  on conflict (codigo_tarjeta) do update
    set vehiculo_id    = excluded.vehiculo_id,
        titular_nombre = coalesce(excluded.titular_nombre, sgc.combustible_tarjeta_map.titular_nombre),
        es_persona     = excluded.es_persona,
        usuario_id     = excluded.usuario_id,
        notas          = excluded.notas,
        updated_at     = now(),
        updated_by     = auth.uid();
end;
$$;
grant execute on function sgc.combustible_tarjeta_map_set(text, uuid, text, boolean, uuid, text) to authenticated, service_role;

commit;
