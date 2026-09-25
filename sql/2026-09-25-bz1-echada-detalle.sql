-- ════════════════════════════════════════════════════════════════════════════
-- BZ1 — El detalle de la echada por UN SOLO camino (RPC), no por la tabla.
-- Nota #77: "when raykler tries to see a 'Detalle de echada' it doesn't work."
-- ════════════════════════════════════════════════════════════════════════════
-- Causa (regla 14 al revés — lista por RPC, detalle por tabla): la LISTA del log
-- viene de `log_combustible` (SECURITY DEFINER → Raykler la ve), pero el DETALLE
-- (`combustible.service.ts:getById`) leía `registros_combustible` DIRECTO con embeds,
-- bajo RLS. Para cualquier fila que el usuario puede LISTAR pero no SELECT-ear
-- directamente, `maybeSingle()` devuelve null (sin error) → el drawer pinta el estado
-- de error humano de BY1 ("No se pudo cargar el detalle de esta echada").
--   Reproducción en dev: Raykler es `es_flota_elevado()` allí, así que las 66 echadas
--   devuelven 200 por embed — el hueco RLS-vs-RPC solo muerde en prod (donde su combo
--   de rol lista por el RPC definer pero no pasa la RLS de la tabla en toda fila).
-- Fix (regla 4/14): un solo camino = RPC `echada_detalle(p_id)` SECURITY DEFINER con
-- el MISMO gate que la lista de aprobación (es_flota_elevado/admin/dueño), y la política
-- `select` de la tabla ALINEADA a ese mismo predicado (guard = RLS) para cualquier
-- pantalla que siga leyendo la tabla. Aditivo/retrocompatible.
-- Apply: node scripts/apply-migration.mjs sql/2026-09-25-bz1-echada-detalle.sql --env dev  →  --env prod --yes
-- Rollback: drop function sgc.echada_detalle(uuid); y restaurar la política select anterior
--   (using: es_flota_elevado() or conductor_id in (select mis_conductor_ids())).
begin;

-- ── El detalle completo de una echada, un solo camino (web + app) ─────────────
-- Devuelve la fila cruda + vehiculo/conductor/registrador (mismos nombres que los
-- embeds que usaba getById, para no romper la plantilla) + revisor + display del
-- vehículo + motivo de revisión + historial ya listo para humanizar (BX2).
create or replace function sgc.echada_detalle(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $fn$
declare
  v_r   sgc.registros_combustible%rowtype;
  v_out jsonb;
begin
  select * into v_r from sgc.registros_combustible where id = p_id;
  if not found then
    return null;  -- paridad con maybeSingle(): fila inexistente → null, no error
  end if;

  -- Gate = mismo predicado que la política select de la tabla (abajo) y que la
  -- cola "Por aprobar": flota-elevado, admin, el chofer dueño, o quien la registró.
  if not (
    sgc.es_flota_elevado() or sgc.is_admin()
    or v_r.registrado_por = auth.uid()
    or exists (select 1 from sgc.conductores c
                where c.id = v_r.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No autorizado para ver esta echada.' using errcode = '42501';
  end if;

  select to_jsonb(v_r)
    || jsonb_build_object(
      -- Embeds con los MISMOS nombres que usaba getById (r.vehiculo?.placa, etc.).
      'vehiculo', case when v_r.vehiculo_id is not null then (
          select jsonb_build_object('placa', v.placa, 'marca', v.marca)
          from sgc.vehiculos v where v.id = v_r.vehiculo_id) end,
      'conductor', case when v_r.conductor_id is not null then (
          select jsonb_build_object('nombre', u.nombre)
          from sgc.conductores c left join sgc.usuarios u on u.id = c.usuario_id
          where c.id = v_r.conductor_id) end,
      'registrador', case when v_r.registrado_por is not null then (
          select jsonb_build_object('nombre', u.nombre)
          from sgc.usuarios u where u.id = v_r.registrado_por) end,
      'revisor', case when v_r.revisada_por is not null then (
          select jsonb_build_object('nombre', u.nombre)
          from sgc.usuarios u where u.id = v_r.revisada_por) end,
      -- Extras para la app y la paridad (no rompen la plantilla web).
      'vehiculo_display', case when v_r.vehiculo_id is not null
          then sgc.vehiculo_display(v_r.vehiculo_id) end,
      'conductor_nombre', (select u.nombre from sgc.conductores c
          left join sgc.usuarios u on u.id = c.usuario_id where c.id = v_r.conductor_id),
      'registrador_nombre', (select nombre from sgc.usuarios where id = v_r.registrado_por),
      'revisada_por_nombre', (select nombre from sgc.usuarios where id = v_r.revisada_por),
      'motivo_revision', sgc.echada_motivo_revision(v_r),
      -- Historial ya con el nombre del editor embebido (el cliente lo humaniza, BX2).
      'historial', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', h.id, 'registro_id', h.registro_id,
                 'antes', h.antes, 'despues', h.despues, 'motivo', h.motivo,
                 'editado_por', h.editado_por, 'editado_como_rol', h.editado_como_rol,
                 'created_at', h.created_at,
                 'editor', jsonb_build_object('nombre', eu.nombre))
               order by h.created_at desc)
        from sgc.registros_combustible_historial h
        left join sgc.usuarios eu on eu.id = h.editado_por
        where h.registro_id = v_r.id), '[]'::jsonb)
    ) into v_out;

  return v_out;
end $fn$;
grant execute on function sgc.echada_detalle(uuid) to authenticated, service_role;

comment on function sgc.echada_detalle(uuid) is
  'BZ1 — detalle completo de una echada por UN SOLO camino (web getById + app). SECURITY '
  'DEFINER con gate es_flota_elevado()/is_admin()/dueño; incluye vehiculo/conductor/'
  'registrador/revisor + display + motivo de revisión + historial. Reemplaza el getById '
  'que leía la tabla con embeds bajo RLS (fallaba para el que lista por RPC pero no SELECT-ea).';

-- ── Alinear la política select de la tabla al MISMO predicado (guard = RLS) ────
-- Antes: es_flota_elevado() OR conductor_id in (mis_conductor_ids()). Le faltaba el
-- caso "quien la registró aunque no sea el conductor" (registrado_por = auth.uid()).
drop policy if exists "registros_combustible: select" on sgc.registros_combustible;
create policy "registros_combustible: select" on sgc.registros_combustible
  for select to authenticated
  using (
    sgc.es_flota_elevado() or sgc.is_admin()
    or registrado_por = auth.uid()
    or (conductor_id in (select sgc.mis_conductor_ids()))
  );

commit;
