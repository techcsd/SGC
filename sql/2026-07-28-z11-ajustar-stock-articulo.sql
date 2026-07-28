-- ============================================================================
-- Z11 — Editar stock desde Artículos como AJUSTE trazable (no update silencioso)
-- PROMPT-6 · FASE 4
-- ============================================================================
-- Crea un conteo tipo 'ajuste' de un solo ítem (antes vs nuevo), aplica el delta
-- al stock y queda trazado (motivo, autor, fecha) → aparece en "Conteos y
-- ajustes". Permiso: admin o módulo inventario.
-- ============================================================================
create or replace function sgc.ajustar_stock_articulo(
  p_articulo_id uuid,
  p_bodega_id uuid,
  p_nueva_cantidad numeric,
  p_motivo text default 'Ajuste manual desde edición de artículo'
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_antes numeric;
  v_conteo_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
    raise exception 'Sin permiso para ajustar stock';
  end if;
  if p_nueva_cantidad is null or p_nueva_cantidad < 0 then
    raise exception 'La cantidad no puede ser negativa';
  end if;

  select coalesce(cantidad, 0) into v_antes
    from sgc.stock_por_bodega
   where articulo_id = p_articulo_id and bodega_id = p_bodega_id;
  v_antes := coalesce(v_antes, 0);

  if v_antes = p_nueva_cantidad then
    return null;  -- sin cambio, no registra nada
  end if;

  v_conteo_id := gen_random_uuid();
  insert into sgc.conteos_inventario (id, bodega_id, motivo, creado_por, tipo, es_prueba, es_prueba_origen)
  values (
    v_conteo_id,
    p_bodega_id,
    coalesce(nullif(trim(p_motivo),''), 'Ajuste manual desde edición de artículo'),
    v_uid, 'ajuste',
    coalesce((select es_prueba from sgc.articulos where id = p_articulo_id), false),
    case when coalesce((select es_prueba from sgc.articulos where id = p_articulo_id), false) then 'heredado' end
  );

  insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada)
  values (v_conteo_id, p_articulo_id, v_antes, p_nueva_cantidad);

  perform sgc.adjust_stock(p_articulo_id, p_bodega_id, p_nueva_cantidad - v_antes);

  return v_conteo_id;
end;
$function$;
grant execute on function sgc.ajustar_stock_articulo(uuid,uuid,numeric,text) to authenticated, service_role;
