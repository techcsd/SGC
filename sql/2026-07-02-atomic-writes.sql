-- ═══════════════════════════════════════════════════════════
-- Atomic writes: role assignment and orden de compra creation
-- were each split into separate non-atomic client-side calls,
-- risking a user left with zero roles or an orphaned order
-- header if the second call failed. Move both into a single
-- transactional RPC.
-- ═══════════════════════════════════════════════════════════

-- 1. Atomic role assignment (replace delete-then-insert from the client)
create or replace function sgc.assign_roles(p_usuario_id uuid, p_rol_ids integer[], p_asignado_por uuid)
returns void
language plpgsql
as $$
begin
  delete from sgc.usuarios_roles where usuario_id = p_usuario_id;

  if p_rol_ids is not null and array_length(p_rol_ids, 1) > 0 then
    insert into sgc.usuarios_roles (usuario_id, rol_id, asignado_por)
    select p_usuario_id, rid, p_asignado_por
    from unnest(p_rol_ids) as rid;
  end if;
end;
$$;

grant execute on function sgc.assign_roles(uuid, integer[], uuid) to authenticated;

-- 2. Atomic orden de compra creation (header + items in one transaction)
--    Also replaces the non-sequential 'OC-' || Date.now() numbering.
create sequence if not exists sgc.ordenes_compra_numero_seq;

create or replace function sgc.crear_orden_compra(
  p_proveedor_id uuid,
  p_proyecto_id uuid,
  p_estado text,
  p_fecha date,
  p_fecha_entrega_esperada date,
  p_subtotal numeric,
  p_impuesto numeric,
  p_total numeric,
  p_notas text,
  p_creado_por uuid,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_numero text;
  v_orden_id uuid;
begin
  v_numero := 'OC-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('sgc.ordenes_compra_numero_seq')::text, 4, '0');

  insert into sgc.ordenes_compra (
    numero, proveedor_id, proyecto_id, estado, fecha, fecha_entrega_esperada,
    subtotal, impuesto, total, notas, creado_por
  ) values (
    v_numero, p_proveedor_id, p_proyecto_id, p_estado, p_fecha, p_fecha_entrega_esperada,
    p_subtotal, p_impuesto, p_total, p_notas, p_creado_por
  )
  returning id into v_orden_id;

  insert into sgc.orden_compra_items (orden_id, articulo_id, descripcion, cantidad, precio_unitario, total)
  select
    v_orden_id,
    nullif(i->>'articulo_id', '')::uuid,
    i->>'descripcion',
    (i->>'cantidad')::numeric,
    (i->>'precio_unitario')::numeric,
    (i->>'total')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_orden_id;
end;
$$;

grant execute on function sgc.crear_orden_compra(uuid, uuid, text, date, date, numeric, numeric, numeric, text, uuid, jsonb) to authenticated;
