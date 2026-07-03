-- ═══════════════════════════════════════════════════════════
-- Purchase-order-to-receipt linking (Odoo calls this "Receipts" matched
-- against "Purchase Orders"; Oracle SCM calls it PO receiving). Deliberately
-- scoped down from full 3-way-match/per-line quantity reconciliation:
-- sgc.orden_compra_items.articulo_id is nullable and, in real usage, always
-- null — Compras orders are free-text line items ("cemento gris 42.5kg",
-- qty, price), not matched against the sgc.articulos catalog. Automatic
-- per-article received-vs-ordered math (the pattern used for
-- confirmar_recepcion_salida) would silently do nothing for every real
-- order today, so this instead gives staff the traceability they're
-- actually missing — "which entradas fulfilled this PO" — and lets them
-- make an informed recibida/recibida_parcial call themselves, backed by
-- real visible receiving history instead of a blind label flip.
-- ═══════════════════════════════════════════════════════════

alter table sgc.entradas_inventario
  add column orden_compra_id uuid references sgc.ordenes_compra(id);

-- Inventario staff need to see approved orders to link a delivery to the
-- right one — previously ordenes_compra/orden_compra_items were
-- compras/admin-only for SELECT. Explicitly confirmed with the user
-- before applying (write access is unchanged: inventario still can't
-- create/edit/approve orders).
drop policy "ordenes_compra: select" on sgc.ordenes_compra;
create policy "ordenes_compra: select" on sgc.ordenes_compra for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario'));

drop policy "orden_compra_items: select" on sgc.orden_compra_items;
create policy "orden_compra_items: select" on sgc.orden_compra_items for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('compras') or sgc.tiene_modulo('inventario'));

-- Atomic entrada creation (header + items in one transaction) — the
-- existing entradas.service.ts create() did two separate client-side
-- calls with no transaction, same non-atomicity class of bug fixed
-- earlier this session for solicitudes/ordenes. Fixed as part of this
-- change since it's the same code path being extended anyway.
create or replace function sgc.registrar_entrada_inventario(
  p_fecha date,
  p_bodega_id uuid,
  p_proveedor_id uuid,
  p_orden_compra_id uuid,
  p_referencia text,
  p_observaciones text,
  p_creado_por uuid,
  p_items jsonb -- [{articulo_id, cantidad, precio_unit}, ...]
)
returns uuid
language plpgsql
as $$
declare
  v_entrada_id uuid;
  v_orden_estado text;
begin
  if p_orden_compra_id is not null then
    select estado into v_orden_estado from sgc.ordenes_compra where id = p_orden_compra_id;
    if v_orden_estado is null then
      raise exception 'Orden de compra no encontrada.';
    end if;
    if v_orden_estado not in ('aprobada', 'recibida_parcial') then
      raise exception 'Solo se pueden registrar entradas contra una orden aprobada o parcialmente recibida.';
    end if;
  end if;

  insert into sgc.entradas_inventario (fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones, creado_por)
  values (p_fecha, p_bodega_id, p_proveedor_id, p_orden_compra_id, p_referencia, p_observaciones, p_creado_por)
  returning id into v_entrada_id;

  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
  select v_entrada_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'precio_unit', '')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_entrada_id;
end;
$$;

grant execute on function sgc.registrar_entrada_inventario(date, uuid, uuid, uuid, text, text, uuid, jsonb) to authenticated;

-- Extends the transition graph sgc.actualizar_estado_orden() enforces —
-- recibida_parcial is a real, honest intermediate state now that partial
-- shipments are visible, not just borrador/aprobada/recibida/cancelada.
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
    when 'aprobada' then p_nuevo_estado in ('recibida', 'recibida_parcial', 'cancelada')
    when 'recibida_parcial' then p_nuevo_estado in ('recibida', 'cancelada')
    else false
  end;

  if not v_permitido then
    raise exception 'No se puede cambiar de "%" a "%".', v_actual, p_nuevo_estado;
  end if;

  update sgc.ordenes_compra set estado = p_nuevo_estado, updated_at = now() where id = p_orden_id;
end;
$$;
