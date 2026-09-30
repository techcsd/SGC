-- ============================================================================
-- CD5 (nota #96) — "Edward no ve datos de Combustible".
--
-- Diagnóstico (prod, como Edward, 30-sep):
--   1) MT 03 tiene **0 echadas** en registros_combustible → la ficha mostrando
--      "Combustible 0 · 0 gal · RD$ 0" es HONESTA, no un bloqueo. (root cause = falsa
--      premisa en parte: no hay dato que ver para MT 03.)
--   2) Como regla general, un chofer solo ve SUS echadas (puede_ver_echada = elevado
--      /admin/registró/es-conductor). Si el vehículo que tiene asignado tiene echadas
--      registradas por otro, no las ve. La vista v_vehiculo_stats es security_invoker
--      → sus KPI de combustible se filtran por RLS igual.
--
-- Regla de negocio (ROLES.md): el chofer ve **todas las echadas del vehículo que tiene
-- asignado mientras lo tenga** (asignación vigente ∪ uso abierto ∪ responsable) + las
-- suyas de siempre. Fix = overload de puede_ver_echada con vehiculo_id que reutiliza el
-- predicado único puede_ver_vehiculo (CD4). Al cambiar SOLO la política, la vista
-- invoker y la ficha heredan el arreglo (regla 14, un solo predicado).
--
-- ⚠️ Depende de sql/2026-09-30-cd4-visibilidad-vehiculo.sql (puede_ver_vehiculo).
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd5-combustible-chofer-vehiculo.sql --env dev  →  --env prod
-- ============================================================================
begin;

-- Overload 3-arg: mantiene la lógica de 2-arg (dueño/conductor/elevado) y añade
-- "el vehículo lo tengo yo" (asignado/en uso/responsable).
create or replace function sgc.puede_ver_echada(
  p_registrado_por uuid, p_conductor_id uuid, p_vehiculo_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select sgc.puede_ver_echada(p_registrado_por, p_conductor_id)
      or (p_vehiculo_id is not null and sgc.puede_ver_vehiculo(p_vehiculo_id, auth.uid()));
$function$;

grant execute on function sgc.puede_ver_echada(uuid, uuid, uuid) to authenticated;

-- La política de lectura pasa a usar el overload con vehiculo_id.
drop policy if exists "registros_combustible: select" on sgc.registros_combustible;
create policy "registros_combustible: select" on sgc.registros_combustible
  for select to authenticated
  using ( sgc.puede_ver_echada(registrado_por, conductor_id, vehiculo_id) );

commit;
