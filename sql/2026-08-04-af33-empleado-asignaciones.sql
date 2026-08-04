-- ============================================================================
-- AF33 — Asignaciones de la empresa a empleados (equipos, uniformes, cascos…)
-- Ronda 03/08/2026 (IDs AF) — PROMPT-1 FASE 6
--
-- NO duplica catálogos: una asignación puede REFERENCIAR un activo fijo
-- (sgc.activos_fijos) o un artículo de inventario (sgc.articulos), o ser un
-- item libre (nombre a mano). Modela lo que ningún catálogo modela hoy: la
-- entrega empleado↔item con estado (asignado/devuelto/perdido/dañado) e
-- historial completo.
--
-- Aditivo, idempotente, respeta es_prueba. Foto en bucket sgc-rrhh (existente).
-- ============================================================================

create table if not exists sgc.empleado_asignaciones (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references sgc.empleados(id) on delete cascade,
  item_tipo     text not null default 'libre' check (item_tipo in ('activo_fijo', 'articulo', 'libre')),
  item_id       uuid,                    -- ref a activos_fijos.id | articulos.id (sin FK: polimórfico)
  item_nombre   text not null,           -- snapshot / nombre libre
  categoria     text,                    -- casco | uniforme | herramienta | equipo | EPP | otro
  foto_path     text,                    -- bucket sgc-rrhh
  estado        text not null default 'asignado' check (estado in ('asignado', 'devuelto', 'perdido', 'dañado')),
  asignado_por  uuid references sgc.usuarios(id),
  asignado_en   timestamptz not null default now(),
  devuelto_en   timestamptz,
  notas         text,
  es_prueba     boolean not null default false,
  es_prueba_origen text not null default 'manual',
  created_at    timestamptz not null default now()
);
create index if not exists idx_emp_asig_empleado on sgc.empleado_asignaciones (empleado_id, estado);
create index if not exists idx_emp_asig_item on sgc.empleado_asignaciones (item_tipo, item_id);

create table if not exists sgc.empleado_asignacion_eventos (
  id            uuid primary key default gen_random_uuid(),
  asignacion_id uuid not null references sgc.empleado_asignaciones(id) on delete cascade,
  estado        text not null,
  nota          text,
  por           uuid references sgc.usuarios(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_emp_asig_ev on sgc.empleado_asignacion_eventos (asignacion_id, created_at desc);

alter table sgc.empleado_asignaciones        enable row level security;
alter table sgc.empleado_asignacion_eventos  enable row level security;

-- RRHH/admin gestiona; el empleado ve lo suyo (contrato de la app, lectura).
drop policy if exists "emp_asig: read" on sgc.empleado_asignaciones;
create policy "emp_asig: read" on sgc.empleado_asignaciones
  for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('rrhh')
    or exists (select 1 from sgc.empleados e where e.id = empleado_id and e.usuario_id = auth.uid())
  );

drop policy if exists "es_prueba: oculta a no-admin" on sgc.empleado_asignaciones;
create policy "es_prueba: oculta a no-admin" on sgc.empleado_asignaciones
  as restrictive for select to authenticated
  using (not es_prueba or sgc.is_admin());

drop policy if exists "emp_asig_ev: read" on sgc.empleado_asignacion_eventos;
create policy "emp_asig_ev: read" on sgc.empleado_asignacion_eventos
  for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('rrhh')
    or exists (
      select 1 from sgc.empleado_asignaciones a
      join sgc.empleados e on e.id = a.empleado_id
      where a.id = asignacion_id and e.usuario_id = auth.uid()
    )
  );

grant select on sgc.empleado_asignaciones       to authenticated;
grant select on sgc.empleado_asignacion_eventos to authenticated;
grant all on sgc.empleado_asignaciones       to service_role;
grant all on sgc.empleado_asignacion_eventos to service_role;
-- Escritura vía RPC SECURITY DEFINER (abajo).

-- ── Asignar un item a un empleado ───────────────────────────────────────────
create or replace function sgc.asignar_item_empleado(
  p_empleado_id uuid,
  p_item_nombre text,
  p_item_tipo   text default 'libre',
  p_item_id     uuid default null,
  p_categoria   text default null,
  p_foto_path   text default null,
  p_notas       text default null
) returns uuid
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_es_prueba boolean := false;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('rrhh')) then
    raise exception 'Sin permiso para asignar items a empleados';
  end if;
  if coalesce(p_item_tipo,'libre') not in ('activo_fijo','articulo','libre') then
    raise exception 'Tipo de item inválido';
  end if;
  if coalesce(trim(p_item_nombre),'') = '' then raise exception 'El item necesita un nombre'; end if;

  select coalesce(es_prueba, false) into v_es_prueba from sgc.empleados where id = p_empleado_id;

  insert into sgc.empleado_asignaciones (
    empleado_id, item_tipo, item_id, item_nombre, categoria, foto_path,
    estado, asignado_por, es_prueba, es_prueba_origen
  ) values (
    p_empleado_id, coalesce(p_item_tipo,'libre'), p_item_id, p_item_nombre, p_categoria, p_foto_path,
    'asignado', v_uid, coalesce(v_es_prueba,false),
    case when coalesce(v_es_prueba,false) then 'heredado' else 'manual' end
  ) returning id into v_id;

  insert into sgc.empleado_asignacion_eventos (asignacion_id, estado, nota, por)
  values (v_id, 'asignado', p_notas, v_uid);

  return v_id;
end;
$$;
grant execute on function sgc.asignar_item_empleado(uuid, text, text, uuid, text, text, text) to authenticated, service_role;

-- ── Cambiar el estado de una asignación (devuelto/perdido/dañado/asignado) ──
create or replace function sgc.cambiar_estado_asignacion(
  p_asignacion_id uuid,
  p_estado        text,
  p_nota          text default null
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('rrhh')) then
    raise exception 'Sin permiso para cambiar la asignación';
  end if;
  if p_estado not in ('asignado','devuelto','perdido','dañado') then
    raise exception 'Estado inválido: %', p_estado;
  end if;

  update sgc.empleado_asignaciones
     set estado = p_estado,
         devuelto_en = case when p_estado = 'devuelto' then now() else devuelto_en end
   where id = p_asignacion_id;

  insert into sgc.empleado_asignacion_eventos (asignacion_id, estado, nota, por)
  values (p_asignacion_id, p_estado, p_nota, v_uid);
end;
$$;
grant execute on function sgc.cambiar_estado_asignacion(uuid, text, text) to authenticated, service_role;

-- ── Lectura: eventos de una asignación (con nombre de quién) ─────────────────
create or replace function sgc.asignacion_eventos_de(p_asignacion_id uuid)
returns table (estado text, nota text, por_nombre text, created_at timestamptz)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select ev.estado, ev.nota, u.nombre, ev.created_at
  from sgc.empleado_asignacion_eventos ev
  left join sgc.usuarios u on u.id = ev.por
  where ev.asignacion_id = p_asignacion_id
  order by ev.created_at desc;
$$;
grant execute on function sgc.asignacion_eventos_de(uuid) to authenticated, service_role;
