-- ============================================================================
-- PROMPT-9 · FASE 5 — AA21: entradas/salidas de prueba NO afectan el stock real
-- Fecha: 2026-07-29
-- Aditivo / idempotente.
--
-- Problema (gap de Z5): `entradas_inventario`/`salidas_inventario` ya tenían el
-- flag `es_prueba` y RLS que oculta las FILAS a no-admin, pero el efecto en STOCK
-- no estaba aislado. Los triggers `trg_detalle_(entradas|salidas)_stock` llamaban
-- a `adjust_stock` SIEMPRE, así que un movimiento de prueba movía el stock real
-- de `stock_por_bodega` — que no tiene es_prueba ni RLS restrictiva —, y los
-- no-admin veían un stock contaminado por datos de prueba.
--
-- Decisión (CONTEXTO AA21): los movimientos de prueba NO afectan el stock real.
-- Se ven como filas marcadas "PRUEBA" (RLS existente), pero no mueven existencias.
-- El stock queda reflejando SOLO movimientos reales, para todos.
--
-- Fix: (1) los triggers de stock saltan `adjust_stock` cuando el movimiento padre
-- es de prueba; (2) reconciliación una sola vez: se revierte el efecto en stock
-- de TODOS los movimientos de prueba que hoy existen (deshace la contaminación).
--
-- Limitación conocida (documentada): marcar como prueba un movimiento REAL ya
-- existente (vía cascada proyecto/bodega) no revierte retroactivamente su stock;
-- la exclusión aplica a movimientos creados/reconciliados desde esta migración.
-- ============================================================================

-- ── (1) Triggers de stock: saltar movimientos de prueba ──────────────────────
create or replace function sgc.trg_detalle_entradas_stock()
returns trigger language plpgsql as $function$
declare v_bodega_id uuid; v_prueba boolean;
begin
  if tg_op = 'INSERT' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = new.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(new.articulo_id, v_bodega_id, new.cantidad); end if;
    return new;
  elsif tg_op = 'DELETE' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = old.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(old.articulo_id, v_bodega_id, -old.cantidad); end if;
    return old;
  elsif tg_op = 'UPDATE' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = old.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(old.articulo_id, v_bodega_id, -old.cantidad); end if;
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.entradas_inventario where id = new.entrada_id;
    if not v_prueba then perform sgc.adjust_stock(new.articulo_id, v_bodega_id, new.cantidad); end if;
    return new;
  end if;
  return null;
end;
$function$;

create or replace function sgc.trg_detalle_salidas_stock()
returns trigger language plpgsql as $function$
declare v_bodega_id uuid; v_prueba boolean;
begin
  if tg_op = 'INSERT' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.salidas_inventario where id = new.salida_id;
    if not v_prueba then perform sgc.adjust_stock(new.articulo_id, v_bodega_id, -new.cantidad); end if;
    return new;
  elsif tg_op = 'DELETE' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.salidas_inventario where id = old.salida_id;
    if not v_prueba then perform sgc.adjust_stock(old.articulo_id, v_bodega_id, old.cantidad); end if;
    return old;
  elsif tg_op = 'UPDATE' then
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.salidas_inventario where id = old.salida_id;
    if not v_prueba then perform sgc.adjust_stock(old.articulo_id, v_bodega_id, old.cantidad); end if;
    select bodega_id, coalesce(es_prueba, false) into v_bodega_id, v_prueba
      from sgc.salidas_inventario where id = new.salida_id;
    if not v_prueba then perform sgc.adjust_stock(new.articulo_id, v_bodega_id, -new.cantidad); end if;
    return new;
  end if;
  return null;
end;
$function$;

-- ── (2) Reconciliación única: revertir el efecto en stock de los movimientos
--        de prueba EXISTENTES (hoy contaminan stock_por_bodega). ───────────────
do $$
begin
  -- Entradas de prueba: sumaron stock → restarlo (piso en 0 por el CHECK >= 0).
  update sgc.stock_por_bodega s
     set cantidad = greatest(0, s.cantidad - t.q), updated_at = now()
  from (
    select de.articulo_id, e.bodega_id, sum(de.cantidad) as q
    from sgc.detalle_entradas de
    join sgc.entradas_inventario e on e.id = de.entrada_id
    where coalesce(e.es_prueba, false)
    group by de.articulo_id, e.bodega_id
  ) t
  where s.articulo_id = t.articulo_id and s.bodega_id = t.bodega_id;

  -- Salidas de prueba: restaron stock → devolverlo.
  update sgc.stock_por_bodega s
     set cantidad = s.cantidad + t.q, updated_at = now()
  from (
    select ds.articulo_id, sa.bodega_id, sum(ds.cantidad) as q
    from sgc.detalle_salidas ds
    join sgc.salidas_inventario sa on sa.id = ds.salida_id
    where coalesce(sa.es_prueba, false)
    group by ds.articulo_id, sa.bodega_id
  ) t
  where s.articulo_id = t.articulo_id and s.bodega_id = t.bodega_id;
end $$;
