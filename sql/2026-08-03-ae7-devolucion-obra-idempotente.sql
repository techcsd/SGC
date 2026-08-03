-- AE7 — idempotencia de registrar_devolucion_obra (devolución de obra vía inventario)
--
-- BUG (QA 2026-08-03): el handler offline `inv_devolucion_obra` genera un UUID de
-- cliente pero el RPC `registrar_devolucion_obra` NO lo recibía ni deduplicaba:
-- INSERTABA entrada (+ salida si descontar) en CADA llamada. Si la respuesta se
-- pierde tras el commit (caída de señal, o el timeout de 90s del outbox salta
-- justo después de commitear), el outbox reintenta → SEGUNDA devolución → stock
-- DOBLE-CONTADO en ambas bodegas, en silencio, en producción. Rompe ADR-002.
--
-- FIX: nuevo OVERLOAD de 9 args que recibe `p_id uuid` (el UUID del cliente) y
-- deduplica igual que `registrar_salida_app` (entrada.id = p_id → early return si
-- ya existe). El overload viejo de 8 args se conserva para apps < 1.58.0 (regla:
-- RPCs compatibles ≥2 versiones); las apps nuevas llaman al de 9 args.
-- Idempotente y transaccional: en el reintento, la entrada ya existe → return sin
-- reinsertar (ni entrada ni salida, todo va en la misma transacción).

create or replace function sgc.registrar_devolucion_obra(
  p_fecha date,
  p_bodega_destino_id uuid,
  p_origen_proyecto_id uuid,
  p_descontar boolean,
  p_referencia text,
  p_observaciones text,
  p_creado_por uuid,
  p_items jsonb,
  p_id uuid  -- AE7 — UUID de cliente (idempotencia). El overload de 8 args no lo tiene.
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_entrada_id   uuid;
  v_salida_id    uuid := null;
  v_bodega_orig  uuid;
  v_bodega_dest_nombre text;
  v_obra_nombre  text;
  v_item         jsonb;
  v_stock        numeric;
  v_nombre       text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;

  -- AE7 — idempotencia: si esta devolución (por su UUID de cliente) ya se aplicó,
  -- devolver la entrada existente sin reinsertar nada.
  if p_id is not null and exists (select 1 from sgc.entradas_inventario where id = p_id) then
    return p_id;
  end if;

  if p_bodega_destino_id is null then raise exception 'Falta el almacén destino.'; end if;
  if p_origen_proyecto_id is null then raise exception 'Selecciona la obra de origen.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un artículo.';
  end if;

  select nombre into v_obra_nombre from sgc.proyectos where id = p_origen_proyecto_id;
  if v_obra_nombre is null then raise exception 'Obra de origen no encontrada.'; end if;

  -- ── Traspaso: descontar del almacén de la obra de origen ─────────────────
  if coalesce(p_descontar, false) then
    select id into v_bodega_orig
      from sgc.bodegas
     where proyecto_id = p_origen_proyecto_id and coalesce(activo, true)
     order by coalesce(es_principal, false) desc, created_at asc
     limit 1;

    if v_bodega_orig is null then
      raise exception 'La obra "%" no tiene almacén propio para descontar. Registra la entrada sin descontar.', v_obra_nombre;
    end if;
    if v_bodega_orig = p_bodega_destino_id then
      raise exception 'El almacén de origen y el de destino no pueden ser el mismo.';
    end if;

    for v_item in select * from jsonb_array_elements(p_items) loop
      select s.cantidad, a.nombre into v_stock, v_nombre
      from sgc.stock_por_bodega s join sgc.articulos a on a.id = s.articulo_id
      where s.articulo_id = (v_item->>'articulo_id')::uuid and s.bodega_id = v_bodega_orig;
      v_stock := coalesce(v_stock, 0);
      if v_stock < (v_item->>'cantidad')::numeric then
        raise exception 'Stock insuficiente en el almacén de "%": "%" disponible %, solicitado %.',
          v_obra_nombre, coalesce(v_nombre,'material'), v_stock, (v_item->>'cantidad')::numeric;
      end if;
    end loop;

    select nombre into v_bodega_dest_nombre from sgc.bodegas where id = p_bodega_destino_id;

    insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, observaciones, creado_por)
    values (p_fecha, v_bodega_orig, p_origen_proyecto_id,
            format('Traspaso a %s (devolución de obra)', coalesce(v_bodega_dest_nombre,'almacén')),
            p_observaciones, coalesce(p_creado_por, v_uid))
    returning id into v_salida_id;

    insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad)
    select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
    from jsonb_array_elements(p_items) as i;
  end if;

  -- ── Entrada en el almacén destino (id = p_id para idempotencia) ──────────
  insert into sgc.entradas_inventario (
    id, fecha, bodega_id, referencia, observaciones, creado_por,
    origen_tipo, origen_proyecto_id, salida_id
  ) values (
    coalesce(p_id, gen_random_uuid()),
    p_fecha, p_bodega_destino_id,
    coalesce(nullif(p_referencia,''), format('Devolución de %s', v_obra_nombre)),
    p_observaciones, coalesce(p_creado_por, v_uid),
    'devolucion_obra', p_origen_proyecto_id, v_salida_id
  ) returning id into v_entrada_id;

  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
  select v_entrada_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric,
         nullif(i->>'precio_unit','')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_entrada_id;
end;
$function$;

grant execute on function sgc.registrar_devolucion_obra(date,uuid,uuid,boolean,text,text,uuid,jsonb,uuid) to authenticated;
