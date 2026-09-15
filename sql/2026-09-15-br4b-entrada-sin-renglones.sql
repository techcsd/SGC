-- BR4 (d) — Una entrada sin renglones NO se crea (la captura 4 mostraba "Artículos (0)").
-- Guard en el RPC de creación web (registrar_entrada_inventario, 10-arg) + UI deshabilita.
-- Copia viva con un único bloque nuevo al inicio.

begin;

create or replace function sgc.registrar_entrada_inventario(p_fecha date, p_bodega_id uuid, p_proveedor_id uuid, p_orden_compra_id uuid, p_referencia text, p_observaciones text, p_creado_por uuid, p_items jsonb, p_origen_tipo text DEFAULT NULL::text, p_origen_proyecto_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'sgc', 'pg_temp'
AS $function$
declare
  v_entrada_id uuid;
  v_orden_estado text;
begin
  -- BR4 — no se crea una entrada sin renglones (dato inválido en origen).
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Una entrada debe tener al menos un renglón.' using errcode = '22023', detail = 'campo=items;motivo=vacio';
  end if;

  if p_orden_compra_id is not null then
    select estado into v_orden_estado from sgc.ordenes_compra where id = p_orden_compra_id;
    if v_orden_estado is null then
      raise exception 'Orden de compra no encontrada.';
    end if;
    if v_orden_estado not in ('aprobada', 'recibida_parcial') then
      raise exception 'Solo se pueden registrar entradas contra una orden aprobada o parcialmente recibida.';
    end if;
  end if;

  insert into sgc.entradas_inventario (
    fecha, bodega_id, proveedor_id, orden_compra_id, referencia, observaciones, creado_por,
    origen_tipo, origen_proyecto_id
  )
  values (
    p_fecha, p_bodega_id, p_proveedor_id, p_orden_compra_id, p_referencia, p_observaciones, p_creado_por,
    nullif(p_origen_tipo,''), p_origen_proyecto_id
  )
  returning id into v_entrada_id;

  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad, precio_unit)
  select v_entrada_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'precio_unit', '')::numeric
  from jsonb_array_elements(p_items) as i;

  return v_entrada_id;
end;
$function$;

commit;
