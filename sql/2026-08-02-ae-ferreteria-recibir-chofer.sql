-- ============================================================================
-- AE — El CHOFER recibe/da entrada a su propia compra de ferretería.
-- ----------------------------------------------------------------------------
-- Contexto: `chofer_registrar_compra_ferreteria` (AD6) deja la compra como una
-- entrada PENDIENTE (pendiente_confirmacion=true, origen_tipo='compra', sin mover
-- stock). Hasta ahora SOLO Almacén/Inventario podía confirmarla
-- (`confirmar_entrada_chofer`). Decisión de producto (Xaviel): el chofer que hace
-- la compra puede TAMBIÉN recibir el material y darle entrada al almacén/obra
-- destino cuando lo entrega — sin esperar a Almacén.
--
-- Cambios (aditivos, retrocompatibles):
--   1) `confirmar_entrada_chofer`: se amplía el permiso para permitir además al
--      CREADOR de la entrada, PERO solo cuando origen_tipo='compra' (ferretería).
--      Admin/Inventario siguen igual (la web no cambia). El resto de entradas
--      siguen exigiendo Almacén/Inventario (antifraude intacto salvo ferretería).
--   2) `mis_entradas_ferreteria_pendientes()`: lista las compras de ferretería
--      pendientes visibles para el usuario (sus propias como creador, o todas si
--      es admin/inventario), con sus ítems propuestos — para pintarlas en el app.
-- Idempotente.
-- ============================================================================

set search_path = sgc, public;

-- 1) Confirmar entrada: Almacén/Inventario O el chofer que registró su compra.
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

  select * into e from sgc.entradas_inventario where id = p_entrada_id;
  if e.id is null then raise exception 'Entrada no encontrada'; end if;

  -- AE — permiso: elevado (almacén/inventario) o el CHOFER creador de su compra.
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')
          or (e.creado_por = v_uid and e.origen_tipo = 'compra')) then
    raise exception 'No autorizado para confirmar esta entrada';
  end if;

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

  -- Si venía de una orden de compra, márcala recibida.
  if e.orden_compra_id is not null then
    update sgc.ordenes_compra set estado = 'recibida' where id = e.orden_compra_id and estado <> 'recibida';
  end if;

  return true;
end;
$$;
grant execute on function sgc.confirmar_entrada_chofer(uuid, jsonb) to authenticated, service_role;

-- 2) Compras de ferretería PENDIENTES visibles para el usuario (con ítems).
create or replace function sgc.mis_entradas_ferreteria_pendientes()
returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(row order by fecha desc), '[]'::jsonb) from (
    select e.fecha, jsonb_build_object(
      'id', e.id,
      'fecha', e.fecha,
      'referencia', e.referencia,
      'observaciones', e.observaciones,
      'bodega', b.nombre,
      'bodega_id', e.bodega_id,
      'obra', p.nombre,
      'proyecto_id', e.origen_proyecto_id,
      'foto_path', e.foto_path,
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'articulo_id', (i->>'articulo_id'),
          'nombre', coalesce(a.nombre, 'Material'),
          'unidad', a.unidad,
          'cantidad', coalesce((i->>'cantidad')::numeric, 0))), '[]'::jsonb)
        from jsonb_array_elements(coalesce(e.items_propuestos, '[]'::jsonb)) i
        left join sgc.articulos a on a.id = (i->>'articulo_id')::uuid
      )
    ) as row
    from sgc.entradas_inventario e
    left join sgc.bodegas b on b.id = e.bodega_id
    left join sgc.proyectos p on p.id = e.origen_proyecto_id
    where e.pendiente_confirmacion = true
      and e.origen_tipo = 'compra'
      and (e.creado_por = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('inventario'))
  ) q;
$$;
grant execute on function sgc.mis_entradas_ferreteria_pendientes() to authenticated, service_role;
