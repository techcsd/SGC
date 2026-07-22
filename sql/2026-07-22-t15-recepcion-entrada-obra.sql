-- ============================================================================
-- Actualización 4 — T15: al confirmar la recepción de una salida en una obra
-- con almacén propio, registrar AUTOMÁTICAMENTE la entrada en ese almacén por
-- las cantidades recibidas (espejo del traspaso P12), enlazada a la salida.
-- ----------------------------------------------------------------------------
-- Antes: confirmar_recepcion_salida solo cambiaba estado/cantidades; el material
-- recibido en obra nunca entraba al inventario de la obra. Ahora, si la obra
-- (salida.proyecto_id) tiene bodega y es distinta de la de origen, se crea la
-- entrada por lo efectivamente recibido (>0) en la misma transacción.
-- Aditivo/retrocompatible/idempotente (misma firma; el guard de estado
-- 'despachado' impide doble entrada al reintentar).
-- ============================================================================

set search_path = sgc, public;

-- Permitir el nuevo origen de entrada.
alter table sgc.entradas_inventario drop constraint if exists entradas_inventario_origen_tipo_chk;
alter table sgc.entradas_inventario add constraint entradas_inventario_origen_tipo_chk
  check (origen_tipo is null or origen_tipo = any (array['compra','devolucion_obra','sobrante','otro','recepcion_obra']));

create or replace function sgc.confirmar_recepcion_salida(p_salida_id uuid, p_items jsonb, p_notas text)
returns boolean language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_autorizado boolean; v_incompleto boolean; v_item jsonb;
  v_recibida numeric; v_enviada numeric; v_nombre text;
  v_bodega_obra_id uuid; v_entrada_id uuid;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Salida no encontrada.'; end if;
  if v_salida.estado <> 'despachado' then raise exception 'Esta salida ya tiene una recepción confirmada.'; end if;

  select sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
  into v_autorizado;
  if not v_autorizado then raise exception 'No autorizado para confirmar esta entrega.'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_recibida := (v_item->>'cantidad_recibida')::numeric;
    if v_recibida is not null and v_recibida < 0 then
      raise exception 'La cantidad recibida no puede ser negativa.';
    end if;
    -- QA-010: recibido no puede exceder lo enviado.
    select d.cantidad, a.nombre into v_enviada, v_nombre
    from sgc.detalle_salidas d join sgc.articulos a on a.id = d.articulo_id
    where d.id = (v_item->>'detalle_id')::uuid and d.salida_id = p_salida_id;
    if v_recibida is not null and v_enviada is not null and v_recibida > v_enviada then
      raise exception 'La cantidad recibida (%) de "%" no puede ser mayor que la enviada (%).',
        v_recibida, coalesce(v_nombre,'artículo'), v_enviada;
    end if;

    update sgc.detalle_salidas
    set cantidad_recibida = v_recibida
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  update sgc.salidas_inventario
  set estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
      recibido_por = auth.uid(), recibido_en = now(), notas_recepcion = p_notas
  where id = p_salida_id;

  -- ── T15: entrada automática en el almacén de la obra ────────────────────────
  if v_salida.proyecto_id is not null then
    select id into v_bodega_obra_id
    from sgc.bodegas
    where proyecto_id = v_salida.proyecto_id
    limit 1;

    -- Solo si la obra tiene bodega y no es la misma de origen (evita doble conteo).
    if v_bodega_obra_id is not null and v_bodega_obra_id <> v_salida.bodega_id then
      insert into sgc.entradas_inventario (
        fecha, bodega_id, referencia, observaciones, creado_por,
        origen_tipo, origen_proyecto_id, salida_id
      ) values (
        current_date, v_bodega_obra_id,
        'Recepción de material despachado a la obra',
        p_notas, auth.uid(),
        'recepcion_obra', v_salida.proyecto_id, p_salida_id
      ) returning id into v_entrada_id;

      -- Entrada por lo efectivamente recibido (>0); el trigger de detalle sube stock.
      insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
      select v_entrada_id, d.articulo_id, coalesce(d.cantidad_recibida, d.cantidad)
      from sgc.detalle_salidas d
      where d.salida_id = p_salida_id
        and coalesce(d.cantidad_recibida, d.cantidad) > 0;
    end if;
  end if;

  return v_incompleto;
end;
$function$;
