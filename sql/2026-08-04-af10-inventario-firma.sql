-- AF10 — Firma final en entrada/salida de material. Entrada: firma quien recibe;
-- salida: firma quien entrega. Aditivo: columna firma_path + overload del RPC con
-- p_firma_path (el overload sin firma se conserva ≥2 versiones). La web muestra la
-- firma en el detalle (misma lógica que la foto de evidencia).

alter table sgc.salidas_inventario  add column if not exists firma_path text;
alter table sgc.entradas_inventario add column if not exists firma_path text;

-- ── SALIDA con firma (8 args) ──────────────────────────────────────────────
create or replace function sgc.registrar_salida_app(
  p_id uuid, p_bodega_id uuid, p_proyecto_id uuid, p_motivo text, p_items jsonb,
  p_foto_path text default null, p_capturado_en timestamptz default now(),
  p_firma_path text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item jsonb; v_stock numeric; v_nombre text; v_bodega_nombre text;
  v_solicitado numeric; v_faltantes text[] := array[]::text[]; v_faltantes_j jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then raise exception 'Tu usuario no tiene el módulo Inventario'; end if;
  if exists (select 1 from sgc.salidas_inventario where id = p_id) then return p_id; end if;

  select nombre into v_bodega_nombre from sgc.bodegas where id = p_bodega_id;
  v_bodega_nombre := coalesce(v_bodega_nombre, 'el almacén');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_solicitado := coalesce((v_item->>'cantidad')::numeric, 0);
    select a.nombre, coalesce(s.cantidad, 0) into v_nombre, v_stock
    from sgc.articulos a
    left join sgc.stock_por_bodega s on s.articulo_id = a.id and s.bodega_id = p_bodega_id
    where a.id = (v_item->>'articulo_id')::uuid;
    v_nombre := coalesce(v_nombre, 'artículo desconocido');
    v_stock := coalesce(v_stock, 0);
    if v_stock < v_solicitado then
      v_faltantes := v_faltantes || format(
        'No hay existencia de %s en %s — disponible: %s, solicitado: %s',
        v_nombre, v_bodega_nombre,
        trim(to_char(v_stock, 'FM999999990.###')), trim(to_char(v_solicitado, 'FM999999990.###')));
      v_faltantes_j := v_faltantes_j || jsonb_build_object(
        'articulo_id', v_item->>'articulo_id', 'articulo', v_nombre, 'bodega', v_bodega_nombre,
        'disponible', v_stock, 'solicitado', v_solicitado);
    end if;
  end loop;

  if array_length(v_faltantes, 1) > 0 then
    raise exception '%', array_to_string(v_faltantes, E'\n')
      using hint = 'sin_existencias', detail = jsonb_build_object('faltantes', v_faltantes_j)::text;
  end if;

  insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, creado_por, foto_path, firma_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_proyecto_id, coalesce(p_motivo, 'Consumo en obra'),
          auth.uid(), p_foto_path, nullif(p_firma_path, ''));

  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad, talla)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric, nullif(i->>'talla', '')
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$function$;
grant execute on function sgc.registrar_salida_app(uuid,uuid,uuid,text,jsonb,text,timestamptz,text) to authenticated, service_role;

-- ── ENTRADA con firma (7 args) ─────────────────────────────────────────────
create or replace function sgc.registrar_entrada_app(
  p_id uuid, p_bodega_id uuid, p_referencia text, p_items jsonb,
  p_foto_path text default null, p_capturado_en timestamptz default now(),
  p_firma_path text default null
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then raise exception 'Tu usuario no tiene el módulo Inventario'; end if;
  if exists (select 1 from sgc.entradas_inventario where id = p_id) then return p_id; end if;

  insert into sgc.entradas_inventario (id, fecha, bodega_id, referencia, creado_por, foto_path, firma_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_referencia, auth.uid(), p_foto_path, nullif(p_firma_path, ''));

  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$function$;
grant execute on function sgc.registrar_entrada_app(uuid,uuid,text,jsonb,text,timestamptz,text) to authenticated, service_role;
