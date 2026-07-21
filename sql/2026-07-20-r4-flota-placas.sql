-- ============================================================================
-- R4a — Reportes de flota: resolver la placa aunque el vehículo esté inactivo
-- ----------------------------------------------------------------------------
-- Causa: la RLS de sgc.vehiculos (activo=true OR es_flota_elevado()) filtra a
-- null el join a vehículos inactivos para usuarios no elevados → los reportes de
-- combustible/mantenimiento pintaban el UUID (o "—").
--
-- Solución aditiva: RPC SECURITY DEFINER acotado a id+placa+marca+modelo (sin
-- exponer nada sensible), para resolver la placa denormalizada de TODOS los
-- vehículos (activos e inactivos) desde la web. Gated al módulo flota.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.flota_placas()
returns table (id uuid, placa text, marca text, modelo text, activo boolean)
language sql
security definer
set search_path to 'sgc','pg_temp'
as $$
  select v.id, v.placa, v.marca, v.modelo, coalesce(v.activo, true)
  from sgc.vehiculos v
  where sgc.is_admin() or sgc.tiene_modulo('flota')
$$;
grant execute on function sgc.flota_placas() to authenticated, service_role;
