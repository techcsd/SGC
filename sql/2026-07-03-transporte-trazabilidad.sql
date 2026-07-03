-- ═══════════════════════════════════════════════════════════
-- Material transport traceability, modeled on how mature ERPs (Odoo
-- Stock Transfers, Oracle SCM ship/receive) handle a delivery: the
-- dispatching side and the receiving side are two independent
-- confirmations, and "demand" (what was sent) vs. "done" (what actually
-- arrived) are tracked per line — an incomplete delivery is DETECTED from
-- that comparison, not manually flagged. Adapted down to what CSD
-- actually needs: no separate "planned but not yet picked" phase (a
-- salida already means the stock physically left, matching how
-- registrar_salida_inventario already works), so dispatch = salida
-- creation (already has creado_por/created_at); this only adds the
-- receiving side.
-- ═══════════════════════════════════════════════════════════

alter table sgc.salidas_inventario
  add column estado text not null default 'despachado'
    check (estado in ('despachado', 'entregado', 'entregado_incompleto')),
  add column conductor_id uuid references sgc.conductores(id),
  add column vehiculo_id uuid references sgc.vehiculos(id),
  add column recibido_por uuid references sgc.usuarios(id),
  add column recibido_en timestamptz,
  add column notas_recepcion text;

alter table sgc.detalle_salidas
  add column cantidad_recibida numeric check (cantidad_recibida is null or cantidad_recibida >= 0);

-- ── Read access for the receiving side ──────────────────────────
-- Engineers need to see incoming deliveries for their own project to
-- confirm them — previously salidas_inventario/detalle_salidas were
-- admin/inventario-only, since no other role ever needed to touch them.
drop policy "salidas_inventario: select" on sgc.salidas_inventario;
create policy "salidas_inventario: select" on sgc.salidas_inventario for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = salidas_inventario.proyecto_id and e.usuario_id = auth.uid()
    ))
  );

drop policy "detalle_salidas: select" on sgc.detalle_salidas;
create policy "detalle_salidas: select" on sgc.detalle_salidas for select to authenticated
  using (
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or exists (
      select 1 from sgc.salidas_inventario si
      join sgc.proyecto_empleados pe on pe.proyecto_id = si.proyecto_id
      join sgc.empleados e on e.id = pe.empleado_id
      where si.id = detalle_salidas.salida_id and e.usuario_id = auth.uid()
    )
  );

-- articulos was admin/inventario-only for SELECT too — an engineer
-- confirming a delivery needs to see what the line items actually are
-- (nombre/codigo/unidad). Broadened to all authenticated: this is a
-- materials catalog, not sensitive data, and precisely scoping "only
-- articulos referenced in one of my project's salidas" would need the
-- same deep join repeated everywhere an articulo name is ever displayed
-- to a non-inventario role — not worth the complexity for a catalog
-- table. INSERT/UPDATE stay admin/inventario-only.
drop policy "articulos: select" on sgc.articulos;
create policy "articulos: select" on sgc.articulos for select to authenticated
  using (true);

-- ── Confirm receipt (dual-party confirmation) ───────────────────
-- Callable by admin/inventario (the dispatching side, confirming on the
-- recipient's behalf if needed) OR by a team member of the destination
-- proyecto (the actual receiving side) — either party can close the
-- loop, matching how this really happens on a job site (sometimes it's
-- the engineer, sometimes office staff following up by phone).
-- SECURITY DEFINER with an explicit check, consistent with every other
-- admin-adjacent RPC this session — avoids granting UPDATE on
-- salidas_inventario/detalle_salidas broadly to authenticated.
create or replace function sgc.confirmar_recepcion_salida(
  p_salida_id uuid,
  p_items jsonb, -- [{detalle_id, cantidad_recibida}, ...]
  p_notas text
)
returns boolean -- true if the delivery was incomplete
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean;
  v_incompleto boolean;
  v_item jsonb;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then
    raise exception 'Salida no encontrada.';
  end if;

  if v_salida.estado <> 'despachado' then
    raise exception 'Esta salida ya tiene una recepción confirmada.';
  end if;

  select
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()
    ))
  into v_autorizado;

  if not v_autorizado then
    raise exception 'No autorizado para confirmar esta entrega.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update sgc.detalle_salidas
    set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id
      and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  update sgc.salidas_inventario
  set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
      recibido_por = auth.uid(),
      recibido_en = now(),
      notas_recepcion = p_notas
  where id = p_salida_id;

  return v_incompleto;
end;
$$;

grant execute on function sgc.confirmar_recepcion_salida(uuid, jsonb, text) to authenticated;
