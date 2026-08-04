-- ============================================================================
-- AF32 — Proveedores: ferreterías (visibles para choferes) + acceso jefe de flota
-- Ronda 03/08/2026 (IDs AF) — PROMPT-1 FASE 4
--
--   - Flag is_hardware_store ("Ferretería / visible para choferes") + ubicación
--     (lat/lng) en proveedores.
--   - RLS: el jefe de flota (flota elevado) puede gestionar proveedores (para
--     registrar ferreterías) — el guard de ruta lo limita a Proveedores.
--   - ferreterias_visibles(): listado que consume la app como origen del conduce.
--
-- Aditivo, idempotente.
-- ============================================================================

alter table sgc.proveedores add column if not exists is_hardware_store boolean not null default false;
alter table sgc.proveedores add column if not exists lat numeric;
alter table sgc.proveedores add column if not exists lng numeric;
comment on column sgc.proveedores.is_hardware_store is 'Ferretería visible para choferes como origen de conduce (compra). AF32.';

create index if not exists idx_proveedores_ferreteria on sgc.proveedores (is_hardware_store) where is_hardware_store;

-- ── RLS: sumar al jefe de flota (flota elevado) en gestión de proveedores ────
drop policy if exists "proveedores: select" on sgc.proveedores;
create policy "proveedores: select" on sgc.proveedores
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario') or sgc.es_flota_elevado());

drop policy if exists "proveedores: insert" on sgc.proveedores;
create policy "proveedores: insert" on sgc.proveedores
  for insert to authenticated
  with check (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.es_flota_elevado());

drop policy if exists "proveedores: update" on sgc.proveedores;
create policy "proveedores: update" on sgc.proveedores
  for update to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.es_flota_elevado())
  with check (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.es_flota_elevado());

-- delete se mantiene sólo para compras/admin (el jefe de flota no borra proveedores).

-- ── ferreterias_visibles(): listado para el origen del conduce (choferes) ────
create or replace function sgc.ferreterias_visibles()
returns table (
  id        uuid,
  nombre    text,
  direccion text,
  lat       numeric,
  lng       numeric,
  telefono  text,
  contacto  text
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select p.id, p.nombre, p.direccion, p.lat, p.lng, p.telefono, p.contacto
  from sgc.proveedores p
  where coalesce(p.is_hardware_store, false)
    and coalesce(p.activo, true)
    and not coalesce(p.es_prueba, false)
  order by p.nombre;
$$;
grant execute on function sgc.ferreterias_visibles() to authenticated, service_role;
