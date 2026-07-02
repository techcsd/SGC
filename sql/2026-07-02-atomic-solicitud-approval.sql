-- Atomic approve/reject for solicitudes_material and solicitudes_compra.
--
-- Previously, approving a solicitud was two separate network calls from the
-- client: create the real salida/orden (via registrar_salida_inventario /
-- crear_orden_compra), then a second call to mark the solicitud attended
-- (marcarAtendida). A failure between the two — network blip, closed tab —
-- left a real salida/orden created with stock already deducted, while the
-- solicitud stayed stuck at "pendiente" forever, inviting duplicate
-- fulfillment. This wraps both writes into one plpgsql function (one
-- transaction) per action, closing that edge case.
--
-- Kept SECURITY INVOKER (the default, no DEFINER) — consistent with every
-- other RPC in this schema — so RLS still applies to the calling user; the
-- explicit checks below are redundant with RLS by design (defense in
-- depth + clearer error messages) rather than a replacement for it.

create or replace function sgc.aprobar_solicitud_material(
  p_solicitud_id uuid,
  p_bodega_id uuid,
  p_fecha date,
  p_responsable text,
  p_observaciones text,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_sol sgc.solicitudes_material%rowtype;
  v_salida_id uuid;
begin
  select * into v_sol from sgc.solicitudes_material where id = p_solicitud_id for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue procesada.';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado para aprobar solicitudes de materiales.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes aprobar tu propia solicitud.';
  end if;

  v_salida_id := sgc.registrar_salida_inventario(
    p_fecha, p_bodega_id, v_sol.proyecto_id, 'uso_proyecto',
    p_responsable, p_observaciones, auth.uid(), p_items
  );

  update sgc.solicitudes_material
  set estado = 'entregada', salida_id = v_salida_id, atendido_por = auth.uid(),
      atendido_en = now(), updated_at = now()
  where id = p_solicitud_id;

  return v_salida_id;
end;
$$;

grant execute on function sgc.aprobar_solicitud_material(uuid, uuid, date, text, text, jsonb) to authenticated;

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

  update sgc.solicitudes_material
  set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
      notas = coalesce(p_notas, notas), updated_at = now()
  where id = p_solicitud_id;
end;
$$;

grant execute on function sgc.rechazar_solicitud_material(uuid, text) to authenticated;

create or replace function sgc.aprobar_solicitud_compra(
  p_solicitud_id uuid,
  p_proveedor_id uuid,
  p_fecha date,
  p_fecha_entrega_esperada date,
  p_subtotal numeric,
  p_impuesto numeric,
  p_total numeric,
  p_notas text,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_sol sgc.solicitudes_compra%rowtype;
  v_orden_id uuid;
begin
  select * into v_sol from sgc.solicitudes_compra where id = p_solicitud_id for update;

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'Esta solicitud ya fue procesada.';
  end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para aprobar solicitudes de compra.';
  end if;
  if v_sol.solicitante_id = auth.uid() and not sgc.is_admin() then
    raise exception 'No puedes aprobar tu propia solicitud.';
  end if;

  v_orden_id := sgc.crear_orden_compra(
    p_proveedor_id, v_sol.proyecto_id, 'borrador', p_fecha, p_fecha_entrega_esperada,
    p_subtotal, p_impuesto, p_total, p_notas, auth.uid(), p_items
  );

  update sgc.solicitudes_compra
  set estado = 'convertida', orden_compra_id = v_orden_id, atendido_por = auth.uid(),
      atendido_en = now(), updated_at = now()
  where id = p_solicitud_id;

  return v_orden_id;
end;
$$;

grant execute on function sgc.aprobar_solicitud_compra(uuid, uuid, date, date, numeric, numeric, numeric, text, jsonb) to authenticated;

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

  update sgc.solicitudes_compra
  set estado = 'rechazada', atendido_por = auth.uid(), atendido_en = now(),
      notas = coalesce(p_notas, notas), updated_at = now()
  where id = p_solicitud_id;
end;
$$;

grant execute on function sgc.rechazar_solicitud_compra(uuid, text) to authenticated;
