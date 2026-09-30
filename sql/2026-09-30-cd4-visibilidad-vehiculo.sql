-- ============================================================================
-- CD4 (nota #95) — Mantenimientos como chofer: "canceling statement due to
-- statement timeout". + CD5 reutiliza el predicado.
--
-- Diagnóstico (prod, como Edward Mota, 30-sep): la lista de `mantenimientos` se lee
-- bajo RLS con predicados que llaman funciones SECURITY DEFINER **por fila** en un
-- seq scan (submodulo_nivel_explicito, mis_vehiculo_ids reevaluada). Al volumen
-- actual (8 mant) corre en ~3-50 ms, pero el patrón per-fila es el riesgo latente
-- del timeout (statement_timeout=8s del rol authenticated) bajo carga / plan frío.
-- Además `mis_vehiculo_ids()` = SOLO `responsable_id` → un chofer no ve los
-- mantenimientos del vehículo que tiene ASIGNADO o EN USO, solo del que es responsable.
--
-- Fix (regla 14 — predicado ÚNICO):
--   · sgc.puede_ver_vehiculo(v,u) STABLE — admin/flota-elevado, o el usuario tiene el
--     vehículo (responsable ∪ asignación vigente ∪ uso abierto). Superset del actual.
--   · política "mantenimientos: select" pasa a usar el predicado único.
--   · RPC listar_mantenimientos(filtros, cursor) SECURITY DEFINER con el MISMO predicado,
--     paginado por servidor (cursor fecha,id) → la pantalla no hace seq scan con RLS.
--   · índices para que el predicado y el listado no escaneen tablas completas.
--   · lint "predicado único" extendido a mantenimientos (verify-regresiones).
--
-- Aplicar:  node scripts/apply-migration.mjs sql/2026-09-30-cd4-visibilidad-vehiculo.sql --env dev  →  --env prod
-- ============================================================================
begin;

-- ── 1. Predicado único de visibilidad de vehículo ──────────────────────────
-- Las ramas admin/flota-elevado usan auth.uid() (la sesión actual). Al invocarse
-- desde la política (auth.uid() = usuario) o desde un RPC definer pasando auth.uid()
-- como p_usuario, la evaluación es consistente (mismo patrón que puede_ver_proyecto CA2).
create or replace function sgc.puede_ver_vehiculo(p_vehiculo uuid, p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    sgc.is_admin() or sgc.es_flota_elevado()
    or exists (select 1 from sgc.vehiculos v
                where v.id = p_vehiculo and v.responsable_id = p_usuario)
    or exists (select 1 from sgc.vehiculo_asignaciones va
                where va.vehiculo_id = p_vehiculo and va.usuario_id = p_usuario and va.activa)
    or exists (select 1 from sgc.vehiculo_usos vu
                where vu.vehiculo_id = p_vehiculo and vu.usuario_id = p_usuario and vu.fin_at is null);
$function$;

grant execute on function sgc.puede_ver_vehiculo(uuid, uuid) to authenticated;

-- ── 2. Índices de soporte ──────────────────────────────────────────────────
create index if not exists idx_vehiculos_responsable
  on sgc.vehiculos (responsable_id) where responsable_id is not null;
create index if not exists idx_veh_usos_usuario_abierto
  on sgc.vehiculo_usos (usuario_id) where fin_at is null;
create index if not exists idx_mantenimientos_vehiculo_fecha
  on sgc.mantenimientos (vehiculo_id, fecha desc);

-- ── 3. Política de mantenimientos → predicado único ────────────────────────
drop policy if exists "mantenimientos: select" on sgc.mantenimientos;
create policy "mantenimientos: select" on sgc.mantenimientos
  for select to authenticated
  using ( sgc.puede_ver_vehiculo(vehiculo_id, auth.uid()) );
-- (la política "submod ver: flota.mantenimientos" sigue como OR aparte para
--  personal de oficina con el submódulo pero sin vínculo al vehículo.)

-- ── 4. RPC paginado (mismo predicado) ──────────────────────────────────────
drop function if exists sgc.listar_mantenimientos(uuid, integer, timestamptz, uuid);
create or replace function sgc.listar_mantenimientos(
  p_vehiculo    uuid          default null,
  p_limite      integer       default 50,
  p_cursor_fecha date         default null,
  p_cursor_id   uuid          default null
) returns setof jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select jsonb_build_object(
      'id', m.id, 'vehiculo_id', m.vehiculo_id, 'tipo', m.tipo,
      'descripcion', m.descripcion, 'fecha', m.fecha, 'costo', m.costo,
      'kilometraje_al_mantenimiento', m.kilometraje_al_mantenimiento,
      'proveedor', m.proveedor, 'estado', m.estado, 'notas', m.notas,
      'fotos', m.fotos, 'es_prueba', m.es_prueba,
      'incluye_preventivo', m.incluye_preventivo, 'accidente_id', m.accidente_id,
      'creado_por', m.creado_por, 'created_at', m.created_at,
      'vehiculo', jsonb_build_object('placa', v.placa, 'marca', v.marca, 'modelo', v.modelo),
      'creado_por_usuario', case when u.id is not null then jsonb_build_object('nombre', u.nombre) else null end
    )
  from sgc.mantenimientos m
  left join sgc.vehiculos v on v.id = m.vehiculo_id
  left join sgc.usuarios  u on u.id = m.creado_por
  where ((not m.es_prueba) or sgc.is_admin())
    and ( sgc.puede_ver_vehiculo(m.vehiculo_id, auth.uid())
          or sgc.submodulo_nivel_explicito('flota.mantenimientos') = any(array['ver','operar']) )
    and (p_vehiculo is null or m.vehiculo_id = p_vehiculo)
    and (p_cursor_fecha is null
         or m.fecha < p_cursor_fecha
         or (m.fecha = p_cursor_fecha and m.id < p_cursor_id))
  order by m.fecha desc, m.id desc
  limit greatest(1, least(coalesce(p_limite, 50), 200));
$function$;

grant execute on function sgc.listar_mantenimientos(uuid, integer, date, uuid) to authenticated;

commit;
