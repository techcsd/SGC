-- ============================================================================
-- AE (revert) — Antifraude restaurado: SOLO Almacén/Inventario confirma la
-- entrada de una compra de ferretería (no el chofer). Decisión de Xaviel: se
-- mantiene el control de que Almacén valida antes de subir stock.
-- ----------------------------------------------------------------------------
-- Deshace la ampliación de `2026-08-02-ae-ferreteria-recibir-chofer.sql` (que
-- permitía al creador confirmar su compra). `mis_entradas_ferreteria_pendientes()`
-- SE MANTIENE: el chofer sigue VIENDO sus compras pendientes (solo lectura, para
-- saber que quedaron registradas), pero NO puede darles entrada. Idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.confirmar_entrada_chofer(
  p_entrada_id uuid,
  p_items jsonb default null
) returns boolean
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  e record;
  v_items jsonb;
  it jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  -- Antifraude: solo Almacén/Inventario confirma (sube stock).
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Solo Almacén/Inventario puede confirmar la recepción';
  end if;

  select * into e from sgc.entradas_inventario where id = p_entrada_id;
  if e.id is null then raise exception 'Entrada no encontrada'; end if;
  if not coalesce(e.pendiente_confirmacion, false) then
    return true; -- idempotente: ya confirmada
  end if;

  v_items := coalesce(p_items, e.items_propuestos, '[]'::jsonb);

  -- Materializa el detalle (el trigger detalle_entradas_stock_trigger sube stock).
  for it in select * from jsonb_array_elements(v_items)
  loop
    insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
    values (
      p_entrada_id,
      (it->>'articulo_id')::uuid,
      coalesce((it->>'cantidad')::numeric, 0),
      nullif(it->>'precio_unit','')::numeric
    );
  end loop;

  update sgc.entradas_inventario
     set pendiente_confirmacion = false, items_propuestos = null
   where id = p_entrada_id;

  if e.orden_compra_id is not null then
    update sgc.ordenes_compra set estado = 'recibida' where id = e.orden_compra_id and estado <> 'recibida';
  end if;

  return true;
end;
$$;
grant execute on function sgc.confirmar_entrada_chofer(uuid, jsonb) to authenticated, service_role;
