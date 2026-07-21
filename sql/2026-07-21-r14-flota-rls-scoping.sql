-- ============================================================================
-- R14 — RBAC de Flota: scoping de datos por usuario (21/07/2026)
-- ----------------------------------------------------------------------------
-- Problema: la RLS de flota permitía LEER TODO a cualquier usuario con módulo
-- `flota`. Solo 5 roles tienen `flota`: admin/direccion/gerencia/jefe_flota
-- (= es_flota_elevado()) y chofer_transportista. → El único rol a acotar es el
-- CHOFER: debe ver SOLO sus cosas.
--
-- Regla: cada SELECT pasa a `es_flota_elevado() OR <es_propio>`. Los elevados
-- siguen viendo todo (sin cambio). La app móvil usa RPCs `mis_*`/definer que
-- BYPASSEAN RLS, así que no se rompe. Migración ADITIVA (solo reescribe SELECT).
--
-- Helpers SECURITY DEFINER para no chocar con la RLS de conductores/vehiculos
-- dentro de los predicados.
-- ============================================================================

set search_path = sgc, public;

-- ── Helpers: ids del chofer logueado (definer → sin recursión de RLS) ────────
create or replace function sgc.mis_conductor_ids()
returns setof uuid language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  select id from sgc.conductores where usuario_id = auth.uid()
$$;
grant execute on function sgc.mis_conductor_ids() to authenticated, service_role;

create or replace function sgc.mis_vehiculo_ids()
returns setof uuid language sql stable security definer
set search_path to 'sgc','pg_temp' as $$
  select id from sgc.vehiculos where responsable_id = auth.uid()
$$;
grant execute on function sgc.mis_vehiculo_ids() to authenticated, service_role;

-- ── rutas ────────────────────────────────────────────────────────────────
drop policy if exists "rutas: select" on sgc.rutas;
create policy "rutas: select" on sgc.rutas for select to authenticated
using (
  sgc.es_flota_elevado()
  or creado_por = auth.uid()
  or conductor_id in (select sgc.mis_conductor_ids())
);

-- ── registros_combustible ─────────────────────────────────────────────────
drop policy if exists "registros_combustible: select" on sgc.registros_combustible;
create policy "registros_combustible: select" on sgc.registros_combustible for select to authenticated
using (
  sgc.es_flota_elevado()
  or conductor_id in (select sgc.mis_conductor_ids())
);

-- ── checklists_vehiculo (mantiene su lógica de propio + amplía a mis_conductor) ─
drop policy if exists chk_veh_sel on sgc.checklists_vehiculo;
create policy chk_veh_sel on sgc.checklists_vehiculo for select to authenticated
using (
  sgc.es_flota_elevado()
  or creado_por = auth.uid()
  or conductor_id in (select sgc.mis_conductor_ids())
);

-- ── vehiculo_entregas (responsabilidad: solo las mías) ────────────────────
drop policy if exists ve_select on sgc.vehiculo_entregas;
create policy ve_select on sgc.vehiculo_entregas for select to authenticated
using (
  sgc.es_flota_elevado()
  or conductor_usuario_id = auth.uid()
  or creado_por = auth.uid()
);

-- ── mantenimientos (sin columna de usuario → por vehículo asignado) ───────
drop policy if exists "mantenimientos: select" on sgc.mantenimientos;
create policy "mantenimientos: select" on sgc.mantenimientos for select to authenticated
using (
  sgc.es_flota_elevado()
  or vehiculo_id in (select sgc.mis_vehiculo_ids())
);

-- ── avisos_flota: SELECT solo los relacionados a él; gestión = elevados ────
-- La política FOR ALL (avisos_flota_all) también otorgaba SELECT amplio; se
-- restringe a elevados (los avisos se crean/atienden por RPCs definer, así que
-- el chofer no necesita escribir directamente).
drop policy if exists avisos_flota_sel on sgc.avisos_flota;
create policy avisos_flota_sel on sgc.avisos_flota for select to authenticated
using (
  sgc.es_flota_elevado()
  or conductor_id in (select sgc.mis_conductor_ids())
);
drop policy if exists avisos_flota_all on sgc.avisos_flota;
create policy avisos_flota_all on sgc.avisos_flota for all to authenticated
using (sgc.es_flota_elevado())
with check (sgc.es_flota_elevado());
