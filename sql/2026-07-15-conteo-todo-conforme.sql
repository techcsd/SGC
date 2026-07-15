-- ============================================================================
-- Actualización 3 — V8: conteo "todo conforme" (guardar sin diferencias).
-- ----------------------------------------------------------------------------
-- El conteo debe poder guardarse aunque no haya diferencias, registrando que
-- todo está conforme (fecha/usuario/almacén, cero ajustes). Se añade un param
-- opcional p_observaciones (default null) — las llamadas de 4 args siguen
-- funcionando (retrocompatible). Si no hay ítems o ningún ajuste, se marca la
-- observación como "Todo conforme — sin diferencias".
-- Aditivo/retrocompatible/idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.registrar_conteo_app(
  p_id uuid, p_bodega_id uuid, p_motivo text, p_items jsonb,
  p_observaciones text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_item     jsonb;
  v_antes    numeric;
  v_contada  numeric;
  v_ajustes  int := 0;
  v_total    int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.conteos_inventario where id = p_id) then
    return p_id;
  end if;

  insert into sgc.conteos_inventario (id, bodega_id, motivo, creado_por, observaciones)
  values (p_id, p_bodega_id, coalesce(p_motivo, 'Conteo físico'), auth.uid(), p_observaciones);

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_total := v_total + 1;
    v_contada := (v_item->>'cantidad_contada')::numeric;
    select coalesce(cantidad, 0) into v_antes
    from sgc.stock_por_bodega
    where articulo_id = (v_item->>'articulo_id')::uuid and bodega_id = p_bodega_id;
    v_antes := coalesce(v_antes, 0);

    insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada)
    values (p_id, (v_item->>'articulo_id')::uuid, v_antes, v_contada);

    if v_contada <> v_antes then
      v_ajustes := v_ajustes + 1;
      perform sgc.adjust_stock((v_item->>'articulo_id')::uuid, p_bodega_id, v_contada - v_antes);
    end if;
  end loop;

  -- Sin diferencias (o sin ítems) → registrar explícitamente "todo conforme".
  if v_ajustes = 0 and p_observaciones is null then
    update sgc.conteos_inventario
       set observaciones = case
             when v_total = 0 then 'Todo conforme — sin diferencias (conteo confirmado)'
             else 'Todo conforme — ' || v_total || ' artículos verificados, sin diferencias'
           end
     where id = p_id;
  end if;

  return p_id;
end;
$function$;
grant execute on function sgc.registrar_conteo_app(uuid, uuid, text, jsonb, text) to authenticated, service_role;
