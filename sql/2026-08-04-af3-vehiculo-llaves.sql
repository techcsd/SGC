-- ============================================================================
-- AF3 — Gestión de las 2 llaves por vehículo
-- Ronda 03/08/2026 (IDs AF) — PROMPT-1 FASE 2
--
-- Cada vehículo tiene 2 llaves: normalmente la #1 la lleva el chofer asignado
-- y la #2 se guarda en oficina central. El sistema registra la ubicación/portador
-- de cada una y un historial inmutable de traspasos (quién, cuándo).
--
-- Aditivo, idempotente. Escritura sólo para flota elevado / admin.
-- ============================================================================

-- Estado actual de cada llave (1 fila por llave; máx 2 por vehículo).
create table if not exists sgc.vehiculo_llaves (
  id                  uuid primary key default gen_random_uuid(),
  vehiculo_id         uuid not null references sgc.vehiculos(id) on delete cascade,
  numero              smallint not null check (numero in (1, 2)),
  ubicacion_tipo      text not null default 'oficina_central'
                        check (ubicacion_tipo in ('chofer_asignado', 'oficina_central', 'otro')),
  portador_usuario_id uuid references sgc.usuarios(id),  -- si la tiene un usuario
  ubicacion_detalle   text,                              -- texto libre cuando 'otro'
  actualizado_por     uuid references sgc.usuarios(id),
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (vehiculo_id, numero)
);
create index if not exists idx_vehiculo_llaves_veh on sgc.vehiculo_llaves (vehiculo_id);

-- Historial inmutable de traspasos.
create table if not exists sgc.vehiculo_llave_traspasos (
  id                  uuid primary key default gen_random_uuid(),
  vehiculo_id         uuid not null references sgc.vehiculos(id) on delete cascade,
  numero              smallint not null check (numero in (1, 2)),
  ubicacion_tipo      text not null,
  portador_usuario_id uuid references sgc.usuarios(id),
  ubicacion_detalle   text,
  nota                text,
  registrado_por      uuid references sgc.usuarios(id),
  created_at          timestamptz not null default now()
);
create index if not exists idx_vehiculo_llave_traspasos_veh on sgc.vehiculo_llave_traspasos (vehiculo_id, numero, created_at desc);

alter table sgc.vehiculo_llaves          enable row level security;
alter table sgc.vehiculo_llave_traspasos enable row level security;

drop policy if exists "vehiculo_llaves: read" on sgc.vehiculo_llaves;
create policy "vehiculo_llaves: read" on sgc.vehiculo_llaves
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));

drop policy if exists "vehiculo_llave_traspasos: read" on sgc.vehiculo_llave_traspasos;
create policy "vehiculo_llave_traspasos: read" on sgc.vehiculo_llave_traspasos
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('flota'));

grant select on sgc.vehiculo_llaves          to authenticated;
grant select on sgc.vehiculo_llave_traspasos to authenticated;
grant all    on sgc.vehiculo_llaves          to service_role;
grant all    on sgc.vehiculo_llave_traspasos to service_role;

-- ── Registrar/actualizar una llave (upsert estado + append historial) ───────
create or replace function sgc.set_llave(
  p_vehiculo_id         uuid,
  p_numero              smallint,
  p_ubicacion_tipo      text,
  p_portador_usuario_id uuid    default null,
  p_ubicacion_detalle   text    default null,
  p_nota                text    default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.es_flota_elevado()) then
    raise exception 'Sin permiso para gestionar llaves de vehículo';
  end if;
  if p_numero not in (1, 2) then raise exception 'Número de llave inválido (1 o 2)'; end if;
  if p_ubicacion_tipo not in ('chofer_asignado', 'oficina_central', 'otro') then
    raise exception 'Ubicación inválida: %', p_ubicacion_tipo;
  end if;

  insert into sgc.vehiculo_llaves (
    vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, actualizado_por, updated_at
  ) values (
    p_vehiculo_id, p_numero, p_ubicacion_tipo,
    case when p_ubicacion_tipo = 'chofer_asignado' then p_portador_usuario_id else null end,
    case when p_ubicacion_tipo = 'otro' then p_ubicacion_detalle else null end,
    v_uid, now()
  )
  on conflict (vehiculo_id, numero) do update
    set ubicacion_tipo      = excluded.ubicacion_tipo,
        portador_usuario_id = excluded.portador_usuario_id,
        ubicacion_detalle   = excluded.ubicacion_detalle,
        actualizado_por     = v_uid,
        updated_at          = now()
  returning id into v_id;

  insert into sgc.vehiculo_llave_traspasos (
    vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, nota, registrado_por
  ) values (
    p_vehiculo_id, p_numero, p_ubicacion_tipo,
    case when p_ubicacion_tipo = 'chofer_asignado' then p_portador_usuario_id else null end,
    case when p_ubicacion_tipo = 'otro' then p_ubicacion_detalle else null end,
    p_nota, v_uid
  );

  return v_id;
end;
$$;
grant execute on function sgc.set_llave(uuid, smallint, text, uuid, text, text) to authenticated, service_role;

-- ── Lectura: estado de ambas llaves + nombre del portador ───────────────────
create or replace function sgc.llaves_de(p_vehiculo_id uuid)
returns table (
  numero              smallint,
  ubicacion_tipo      text,
  portador_usuario_id uuid,
  portador_nombre     text,
  ubicacion_detalle   text,
  updated_at          timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select l.numero, l.ubicacion_tipo, l.portador_usuario_id, u.nombre, l.ubicacion_detalle, l.updated_at
  from sgc.vehiculo_llaves l
  left join sgc.usuarios u on u.id = l.portador_usuario_id
  where l.vehiculo_id = p_vehiculo_id
  order by l.numero;
$$;
grant execute on function sgc.llaves_de(uuid) to authenticated, service_role;

-- ── Lectura: historial de traspasos de las llaves de un vehículo ────────────
create or replace function sgc.llave_traspasos_de(p_vehiculo_id uuid)
returns table (
  numero              smallint,
  ubicacion_tipo      text,
  portador_nombre     text,
  ubicacion_detalle   text,
  nota                text,
  registrado_nombre   text,
  created_at          timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select t.numero, t.ubicacion_tipo, up.nombre, t.ubicacion_detalle, t.nota, ur.nombre, t.created_at
  from sgc.vehiculo_llave_traspasos t
  left join sgc.usuarios up on up.id = t.portador_usuario_id
  left join sgc.usuarios ur on ur.id = t.registrado_por
  where t.vehiculo_id = p_vehiculo_id
  order by t.created_at desc;
$$;
grant execute on function sgc.llave_traspasos_de(uuid) to authenticated, service_role;
