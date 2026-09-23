-- BW2 (PROMPT-62 F1) — Vincular / crear artículo desde "Material no catalogado"
-- también para ELEVADOS (logística/flota/gerencia), no solo admin/inventario.
--
-- Nota de Xaviel (23-sep): «When the user select a article there, the selection
-- doesnt apply correctly … That selection must be in the mobile app too.» El bug
-- de UI (picker sin [value]) se arregla en la web; ESTE archivo abre el contrato
-- para que la APP (PROMPT-63 F1) pueda vincular Y crear desde la bandeja:
--   • gate de la vinculación: es_flota_elevado() OR tiene_modulo('inventario')
--     (antes: is_admin() OR tiene_modulo('inventario') — dejaba fuera a Raykler).
--   • RPC atómico nuevo `crear_articulo_desde_libre` (crear + vincular + mov. opcional)
--     con el mismo gate, sin ensanchar `puede_gestionar_articulos()` (edit/borrar/stock
--     del catálogo siguen siendo admin/inventario).
-- Aditivo: solo redefine una función y agrega otra. Rollback = restaurar el gate
-- anterior de vincular_item_libre_articulo y `drop function crear_articulo_desde_libre`.
--
-- BU1 (regla 18): aplicar primero `--env dev`, probar, luego `--env prod --yes`.

-- ── 1) Vincular a un artículo existente: ahora también los elevados ────────────
create or replace function sgc.vincular_item_libre_articulo(
  p_item_libre_id     uuid,
  p_articulo_id       uuid,
  p_generar_movimiento boolean default false
) returns void
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_il sgc.salida_items_libres%rowtype;
  v_s  sgc.salidas_inventario%rowtype;
begin
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.articulos where id = p_articulo_id) then
    raise exception 'Artículo no encontrado.';
  end if;

  select * into v_il from sgc.salida_items_libres where id = p_item_libre_id;
  if not found then raise exception 'Item libre no encontrado.'; end if;
  if v_il.articulo_vinculado_id is not null then
    raise exception 'Este material ya fue vinculado.';
  end if;

  update sgc.salida_items_libres
     set articulo_vinculado_id = p_articulo_id,
         vinculado_at = now(),
         vinculado_por = auth.uid()
   where id = p_item_libre_id;

  -- AY13 — movimiento retroactivo OPCIONAL (per-case). Registra la salida real
  -- desde la bodega de origen del conduce (lo que el material físicamente hizo).
  if coalesce(p_generar_movimiento, false) then
    select * into v_s from sgc.salidas_inventario where id = v_il.salida_id;
    if v_s.bodega_id is null then
      raise exception 'El conduce no tiene bodega de origen; no se puede generar el movimiento.';
    end if;

    insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad)
    values (v_il.salida_id, p_articulo_id, v_il.cantidad);

    perform sgc.adjust_stock(p_articulo_id, v_s.bodega_id, -v_il.cantidad);

    begin
      insert into sgc.auditoria(tabla, registro_id, accion, actor_id, datos_despues)
      values ('salida_items_libres', p_item_libre_id, 'vincular_con_movimiento', auth.uid(),
              jsonb_build_object('articulo_id', p_articulo_id, 'cantidad', v_il.cantidad,
                                 'bodega_id', v_s.bodega_id, 'salida_id', v_il.salida_id));
    exception when others then null; -- la auditoría no debe tumbar la operación
    end;
  end if;
end;
$$;
grant execute on function sgc.vincular_item_libre_articulo(uuid, uuid, boolean) to authenticated, service_role;

-- ── 2) Crear artículo desde el material libre (atómico: crear + vincular) ──────
-- Genera el código (CSD-NN-###) igual que crear_articulo_app, inserta el artículo
-- (los triggers de apertura aplican el piso), lo vincula al item libre y — si se
-- pide — genera el movimiento retroactivo. Un solo RPC para la app y la web.
create or replace function sgc.crear_articulo_desde_libre(
  p_item_libre_id     uuid,
  p_nombre            text,
  p_categoria_id      int,
  p_unidad            text default null,
  p_generar_movimiento boolean default false
) returns jsonb
language plpgsql security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_orden  int;
  v_prefix text;
  v_seq    int;
  v_codigo text;
  v_id     uuid;
  v_il     sgc.salida_items_libres%rowtype;
begin
  if not (sgc.es_flota_elevado() or sgc.tiene_modulo('inventario')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_nombre,'')),'') is null then
    raise exception 'Nombre requerido';
  end if;

  select * into v_il from sgc.salida_items_libres where id = p_item_libre_id;
  if not found then raise exception 'Item libre no encontrado.'; end if;
  if v_il.articulo_vinculado_id is not null then
    raise exception 'Este material ya fue vinculado.';
  end if;

  select orden into v_orden from sgc.categorias_inventario where id = p_categoria_id;
  if not found then raise exception 'Categoría inválida'; end if;

  v_prefix := 'CSD-'||lpad(v_orden::text,2,'0')||'-';
  select coalesce(max((substring(codigo from '([0-9]+)$'))::int),0)+1 into v_seq
    from sgc.articulos where codigo like v_prefix||'%';
  loop
    v_codigo := v_prefix||lpad(v_seq::text,3,'0');
    exit when not exists(select 1 from sgc.articulos where codigo = v_codigo);
    v_seq := v_seq + 1;
  end loop;

  insert into sgc.articulos(nombre, codigo, categoria_id, unidad, propiedad, activo)
    values(trim(p_nombre), v_codigo, p_categoria_id,
           nullif(trim(coalesce(p_unidad,'')),''), 'propio_csd', true)
    returning id into v_id;

  -- Vincular (misma semántica que vincular_item_libre_articulo).
  perform sgc.vincular_item_libre_articulo(p_item_libre_id, v_id, p_generar_movimiento);

  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end;
$$;
grant execute on function sgc.crear_articulo_desde_libre(uuid, text, int, text, boolean) to authenticated, service_role;

comment on function sgc.crear_articulo_desde_libre(uuid, text, int, text, boolean) is
  'BW2 — crea un artículo del catálogo desde un material no catalogado y lo vincula en una sola operación (gate es_flota_elevado() OR tiene_modulo(inventario)). Web/app.';
