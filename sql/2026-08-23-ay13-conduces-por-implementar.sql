-- ════════════════════════════════════════════════════════════════════════════
-- AY13 — "Conduces por implementar": conduces con ≥1 item libre sin vincular
-- ════════════════════════════════════════════════════════════════════════════
-- Aditivo/retrocompatible. Sobre AU4 (salida_items_libres). Un conduce entra a la
-- lista "por implementar" cuando tiene AL MENOS UN item libre pendiente de vincular
-- (articulo_vinculado_id is null). Al vincular TODOS sus items → sale de la lista.
--
-- AY13 (decisión Xaviel): al vincular, se PREGUNTA CASO POR CASO si además se genera
-- el movimiento de inventario retroactivo. Por defecto NO (paridad AU4: el item libre
-- nunca movió stock). Si el gestor lo pide, se registra la salida real desde la bodega
-- de origen del conduce (detalle_salidas + adjust_stock), auditado.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = sgc, public;

-- ── Listado de conduces por implementar (con conteo de items libres pendientes) ──
create or replace function sgc.conduces_por_implementar()
returns table (
  salida_id       uuid,
  conduce_numero  text,
  fecha           date,
  estado          text,
  estado_label    text,
  proyecto        text,
  bodega          text,
  creado_por      text,
  pendientes      int,
  total_libres    int,
  es_prueba       boolean,
  created_at      timestamptz
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id as salida_id,
         'CND-' || upper(left(s.id::text, 8)) as conduce_numero,
         s.fecha, s.estado, sgc.label_estado_salida(s.estado) as estado_label,
         p.nombre as proyecto, b.nombre as bodega,
         u.nombre as creado_por,
         count(*) filter (where il.articulo_vinculado_id is null)::int as pendientes,
         count(*)::int as total_libres,
         coalesce(s.es_prueba, false) as es_prueba,
         s.created_at
  from sgc.salida_items_libres il
  join sgc.salidas_inventario s on s.id = il.salida_id
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.usuarios  u on u.id = s.creado_por
  where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota'))
    and (not coalesce(s.es_prueba, false) or sgc.is_admin())
  group by s.id, p.nombre, b.nombre, u.nombre
  having count(*) filter (where il.articulo_vinculado_id is null) > 0
  order by s.created_at desc;
$$;
grant execute on function sgc.conduces_por_implementar() to authenticated, service_role;

create or replace function sgc.conduces_por_implementar_count()
returns integer language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select count(distinct il.salida_id)::int
  from sgc.salida_items_libres il
  join sgc.salidas_inventario s on s.id = il.salida_id
  where (sgc.is_admin() or sgc.tiene_modulo('inventario') or sgc.tiene_modulo('flota'))
    and il.articulo_vinculado_id is null
    and (not coalesce(s.es_prueba, false) or sgc.is_admin());
$$;
grant execute on function sgc.conduces_por_implementar_count() to authenticated, service_role;

-- ── Vincular item libre → artículo, con opción de generar movimiento (AY13) ──
-- Recrea la firma AU4 (2→3 args). Las llamadas de 2 args resuelven vía default
-- (p_generar_movimiento=false) → comportamiento AU4 intacto.
drop function if exists sgc.vincular_item_libre_articulo(uuid, uuid);
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
  if not (sgc.is_admin() or sgc.tiene_modulo('inventario')) then
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

    -- Traza auditada de la vinculación con movimiento.
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

comment on function sgc.conduces_por_implementar() is
  'AY13 — conduces con ≥1 item libre pendiente de vincular (material no catalogado). Salen de la lista al vincular todos sus items.';
