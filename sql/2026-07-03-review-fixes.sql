-- Fixes from a full-app review pass (three parallel code audits covering
-- every module).

-- ── 1. Self-rejection symmetry ───────────────────────────────
-- aprobar_solicitud_material/compra already block an admin/module-holder
-- from approving their own request; rechazar_solicitud_material/compra
-- had no equivalent check. In practice this was already blocked at the
-- RLS layer (solicitudes_material/compra's UPDATE policy WITH CHECK
-- requires solicitante_id <> auth.uid() unless admin — see
-- sql/2026-07-02-security-review-fixes.sql), so this was not an actual
-- exploitable gap, just an inconsistent/unfriendly error path (a raw RLS
-- violation instead of a clear message). Adding the explicit check for
-- symmetry with the approve path and a real error message.
create or replace function sgc.rechazar_solicitud_material(p_solicitud_id uuid, p_notas text default null)
returns void
language plpgsql
as $$
declare
  v_sol sgc.solicitudes_material%rowtype;
begin
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue procesada.';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para rechazar solicitudes de materiales.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes rechazar tu propia solicitud.';
  end if;

  update sgc.solicitudes_material
  set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
      notas = coalesce(p_notas, notas), updated_at = now()
  where id = p_solicitud_id;
end;
$$;

create or replace function sgc.rechazar_solicitud_compra(p_solicitud_id uuid, p_notas text default null)
returns void
language plpgsql
as $$
declare
  v_sol sgc.solicitudes_compra%rowtype;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_solicitud_id for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue procesada.';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para rechazar solicitudes de compra.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes rechazar tu propia solicitud.';
  end if;

  update sgc.solicitudes_compra
  set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
      notas = coalesce(p_notas, notas), updated_at = now()
  where id = p_solicitud_id;
end;
$$;

-- ── 2. Server-side enforcement for ordenes_compra status transitions ──
-- The valid-transitions graph (borrador -> aprobada|cancelada, aprobada ->
-- recibida|cancelada, recibida/cancelada are terminal) only existed as a
-- client-side map in ordenes.ts; the actual write was a raw table update
-- with no transition check, so a direct API call could skip "aprobada" or
-- resurrect a "cancelada" order. Single source of truth now lives here.
create or replace function sgc.actualizar_estado_orden(p_orden_id uuid, p_nuevo_estado text)
returns void
language plpgsql
as $$
declare
  v_actual text;
  v_permitido boolean;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para cambiar el estado de esta orden.';
  end if;

  select estado into v_actual from sgc.ordenes_compra where id = p_orden_id for update;
  if not found then
    raise exception 'Orden no encontrada.';
  end if;

  v_permitido := case v_actual
    when 'borrador' then p_nuevo_estado in ('aprobada', 'cancelada')
    when 'aprobada' then p_nuevo_estado in ('recibida', 'cancelada')
    else false
  end;

  if not v_permitido then
    raise exception 'No se puede cambiar de "%" a "%".', v_actual, p_nuevo_estado;
  end if;

  update sgc.ordenes_compra set estado = p_nuevo_estado, updated_at = now() where id = p_orden_id;
end;
$$;

grant execute on function sgc.actualizar_estado_orden(uuid, text) to authenticated;

-- ── 3. Backfill sgc.is_admin() into version control ────────────
-- Every privileged RLS policy and RPC in this app gates on sgc.is_admin(),
-- but it was created before this session's SQL-file-tracking convention
-- started and was never captured in a migration file — verified via
-- pg_get_functiondef against the live DB. Recorded here for
-- reproducibility. Also adds the `set search_path` the live version was
-- missing (flagged by mcp__supabase__get_advisors since the very first
-- scan this session, alongside most other functions in this schema —
-- fixing this one while it's already being touched; the rest are a
-- separate, lower-urgency cleanup since they're all fully schema-qualified
-- internally too, same low-actual-risk profile).
create or replace function sgc.is_admin()
returns boolean
language sql
stable
security definer
set search_path = sgc, pg_temp
as $$
  select exists (
    select 1 from sgc.usuarios_roles ur
    join sgc.roles r on r.id = ur.rol_id
    where ur.usuario_id = auth.uid() and r.codigo = 'admin'
  )
$$;
