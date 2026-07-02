-- ═══════════════════════════════════════════════════════════
-- Engineer touchpoints into Inventario/Compras: rather than
-- granting ingeniero_campo those full modules (all suppliers,
-- all orders, all projects' financials), engineers can only
-- create scoped *requests* against their own proyecto, which
-- Inventario/Compras staff see and convert into the real
-- salidas_inventario / ordenes_compra records they already own.
-- ═══════════════════════════════════════════════════════════

create or replace function sgc.tiene_modulo(p_modulo text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and p_modulo = any(r.modulos)
  );
$$;

-- Consolidate the bitácora policies from the previous migration onto this helper.
create or replace function sgc.puede_ver_bitacora(p_bitacora_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from sgc.bitacoras b
    where b.id = p_bitacora_id
      and (b.usuario_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('proyectos'))
  );
$$;

drop policy "bitacoras: select" on sgc.bitacoras;
create policy "bitacoras: select" on sgc.bitacoras for select to authenticated
  using (usuario_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('proyectos'));

-- ── Solicitudes de Materiales ────────────────────────────────
create table sgc.solicitudes_material (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references sgc.proyectos(id),
  solicitante_id uuid not null references sgc.usuarios(id),
  estado         text not null default 'pendiente'
                   check (estado in ('pendiente', 'aprobada', 'rechazada', 'entregada')),
  urgencia       text not null default 'normal' check (urgencia in ('normal', 'urgente')),
  notas          text,
  salida_id      uuid references sgc.salidas_inventario(id),
  atendido_por   uuid references sgc.usuarios(id),
  atendido_en    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_solicitudes_material_proyecto on sgc.solicitudes_material(proyecto_id);
create index idx_solicitudes_material_estado on sgc.solicitudes_material(estado);

create table sgc.solicitud_material_items (
  id           uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references sgc.solicitudes_material(id) on delete cascade,
  articulo_id  uuid references sgc.articulos(id),
  descripcion  text not null,
  cantidad     numeric not null check (cantidad > 0),
  unidad       text
);
create index idx_solicitud_material_items on sgc.solicitud_material_items(solicitud_id);

alter table sgc.solicitudes_material enable row level security;
create policy "solicitudes_material: select" on sgc.solicitudes_material for select to authenticated
  using (solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('inventario'));
create policy "solicitudes_material: insert" on sgc.solicitudes_material for insert to authenticated
  with check (solicitante_id = auth.uid());
create policy "solicitudes_material: update" on sgc.solicitudes_material for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
grant select, insert, update on sgc.solicitudes_material to authenticated;

alter table sgc.solicitud_material_items enable row level security;
create policy "solicitud_material_items: select" on sgc.solicitud_material_items for select to authenticated
  using (exists (
    select 1 from sgc.solicitudes_material s where s.id = solicitud_id
      and (s.solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('inventario'))
  ));
create policy "solicitud_material_items: insert" on sgc.solicitud_material_items for insert to authenticated
  with check (exists (
    select 1 from sgc.solicitudes_material s where s.id = solicitud_id and s.solicitante_id = auth.uid()
  ));
grant select, insert on sgc.solicitud_material_items to authenticated;

create or replace function sgc.crear_solicitud_material(
  p_proyecto_id uuid,
  p_solicitante_id uuid,
  p_urgencia text,
  p_notas text,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_solicitud_id uuid;
begin
  insert into sgc.solicitudes_material (proyecto_id, solicitante_id, urgencia, notas)
  values (p_proyecto_id, p_solicitante_id, p_urgencia, p_notas)
  returning id into v_solicitud_id;

  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad)
  select v_solicitud_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad'
  from jsonb_array_elements(p_items) as i;

  return v_solicitud_id;
end;
$$;

grant execute on function sgc.crear_solicitud_material(uuid, uuid, text, text, jsonb) to authenticated;

-- ── Solicitudes de Compra ────────────────────────────────────
create table sgc.solicitudes_compra (
  id              uuid primary key default gen_random_uuid(),
  proyecto_id     uuid not null references sgc.proyectos(id),
  solicitante_id  uuid not null references sgc.usuarios(id),
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente', 'convertida', 'rechazada')),
  notas           text,
  orden_compra_id uuid references sgc.ordenes_compra(id),
  atendido_por    uuid references sgc.usuarios(id),
  atendido_en     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_solicitudes_compra_proyecto on sgc.solicitudes_compra(proyecto_id);
create index idx_solicitudes_compra_estado on sgc.solicitudes_compra(estado);

create table sgc.solicitud_compra_items (
  id                  uuid primary key default gen_random_uuid(),
  solicitud_id        uuid not null references sgc.solicitudes_compra(id) on delete cascade,
  descripcion         text not null,
  cantidad            numeric not null check (cantidad > 0),
  proveedor_sugerido  text
);
create index idx_solicitud_compra_items on sgc.solicitud_compra_items(solicitud_id);

alter table sgc.solicitudes_compra enable row level security;
create policy "solicitudes_compra: select" on sgc.solicitudes_compra for select to authenticated
  using (solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('compras'));
create policy "solicitudes_compra: insert" on sgc.solicitudes_compra for insert to authenticated
  with check (solicitante_id = auth.uid());
create policy "solicitudes_compra: update" on sgc.solicitudes_compra for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras'));
grant select, insert, update on sgc.solicitudes_compra to authenticated;

alter table sgc.solicitud_compra_items enable row level security;
create policy "solicitud_compra_items: select" on sgc.solicitud_compra_items for select to authenticated
  using (exists (
    select 1 from sgc.solicitudes_compra s where s.id = solicitud_id
      and (s.solicitante_id = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('compras'))
  ));
create policy "solicitud_compra_items: insert" on sgc.solicitud_compra_items for insert to authenticated
  with check (exists (
    select 1 from sgc.solicitudes_compra s where s.id = solicitud_id and s.solicitante_id = auth.uid()
  ));
grant select, insert on sgc.solicitud_compra_items to authenticated;

create or replace function sgc.crear_solicitud_compra(
  p_proyecto_id uuid,
  p_solicitante_id uuid,
  p_notas text,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_solicitud_id uuid;
begin
  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, notas)
  values (p_proyecto_id, p_solicitante_id, p_notas)
  returning id into v_solicitud_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido)
  select v_solicitud_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido'
  from jsonb_array_elements(p_items) as i;

  return v_solicitud_id;
end;
$$;

grant execute on function sgc.crear_solicitud_compra(uuid, uuid, text, jsonb) to authenticated;
