-- ============================================================================
-- Actualización 4 — T13a: mensaje de "stock insuficiente" con nombre real y
-- lista completa de faltantes.
-- ----------------------------------------------------------------------------
-- Causa: registrar_salida_inventario tomaba el nombre desde un join que PARTE
-- de stock_por_bodega; si el artículo no tiene fila de stock en esa bodega, el
-- nombre quedaba NULL → "Stock insuficiente para '<NULL>'". Además fallaba en el
-- primer renglón sin existencia, sin reportar los demás.
--
-- Fix: leer el nombre desde sgc.articulos (LEFT JOIN stock_por_bodega), acumular
-- TODOS los renglones faltantes y lanzar una sola excepción con un mensaje
-- user-friendly que los liste. Mismo tratamiento en el RPC de la app móvil.
-- Aditivo/retrocompatible/idempotente (misma firma).
-- ============================================================================

set search_path = sgc, public;

-- ── Salida directa (web) ─────────────────────────────────────────────────────
create or replace function sgc.registrar_salida_inventario(
  p_fecha date, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text,
  p_responsable character varying, p_observaciones text, p_creado_por uuid, p_items jsonb
)
returns uuid
language plpgsql
as $function$
declare
  v_salida_id     uuid;
  v_item          jsonb;
  v_stock_actual  numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
begin
  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  -- Validar TODOS los renglones y acumular los faltantes (no fallar uno por uno).
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0)
      into v_nombre, v_stock_actual
    from sgc.articulos a
    left join sgc.stock_por_bodega s
      on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;

    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock_actual := coalesce(v_stock_actual, 0);

    if v_stock_actual < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock_actual, 'FM999999990.###')),
        trim(to_char(v_solicitado,  'FM999999990.###'))
      );
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n');
  end if;

  insert into sgc.salidas_inventario (fecha, bodega_id, proyecto_id, motivo, responsable, observaciones, creado_por)
  values (p_fecha, p_bodega_id, p_proyecto_id, p_motivo, p_responsable, p_observaciones, p_creado_por)
  returning id into v_salida_id;

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select v_salida_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;

  return v_salida_id;
end;
$function$;

-- ── Salida (app móvil, offline-idempotente) — mismo tratamiento ──────────────
create or replace function sgc.registrar_salida_app(
  p_id uuid, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_items jsonb,
  p_foto_path text default null, p_capturado_en timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item          jsonb;
  v_stock         numeric;
  v_nombre        text;
  v_bodega_nombre text;
  v_solicitado    numeric;
  v_faltantes     text[] := array[]::text[];
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;
  end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0)
      into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s
      on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;

    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock := coalesce(v_stock, 0);

    if v_stock < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock, 'FM999999990.###')),
        trim(to_char(v_solicitado, 'FM999999990.###'))
      );
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n');
  end if;

  insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, creado_por, foto_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_proyecto_id, coalesce(p_motivo, 'Consumo en obra'), auth.uid(), p_foto_path);

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$function$;
