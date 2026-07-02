-- Fixes a critical, previously-undetected bug in sgc.adjust_stock(): any call
-- with a negative delta (i.e. every inventory *salida*) against an
-- articulo/bodega pair that already has a stock row failed with:
--   ERROR: 23514  new row for relation "stock_por_bodega" violates check
--   constraint "stock_por_bodega_cantidad_check"
-- even when the resulting stock (existing + delta) was >= 0.
--
-- Root cause: Postgres's `INSERT ... ON CONFLICT DO UPDATE` performs a
-- speculative insert of the raw VALUES-clause row and validates CHECK
-- constraints against THAT row before conflict arbitration ever runs. The old
-- implementation did:
--   insert into stock_por_bodega (..., cantidad, ...) values (..., p_delta, ...)
--   on conflict (articulo_id, bodega_id)
--   do update set cantidad = stock_por_bodega.cantidad + excluded.cantidad, ...
-- so a negative p_delta (e.g. -1) got checked against `cantidad >= 0` on its
-- own — failing immediately — before Postgres ever got to add it to the
-- existing (sufficient) stock. This affected every real Inventario salida,
-- since a stock row almost always already exists for the articulo/bodega.
--
-- Fix: replace the ON CONFLICT upsert with an explicit
-- `SELECT ... FOR UPDATE` lock + branch (update if found, insert if not).
-- This never attempts to insert the raw delta as its own row, so the CHECK
-- constraint only ever validates the real final quantity. Also replaces the
-- opaque constraint-violation error with a clear "Stock insuficiente:
-- disponible X, solicitado Y" business message.
--
-- Verified via BEGIN;...ROLLBACK; tests (no persisted writes) covering:
-- negative delta within stock, negative delta exceeding stock (raises the new
-- clear error), and the full sgc.registrar_salida_inventario(...) RPC
-- end-to-end. Applied live via mcp__supabase__apply_migration.

create or replace function sgc.adjust_stock(p_articulo_id uuid, p_bodega_id uuid, p_delta numeric)
returns void
language plpgsql
as $function$
declare
  v_actual numeric;
begin
  select cantidad into v_actual
  from sgc.stock_por_bodega
  where articulo_id = p_articulo_id and bodega_id = p_bodega_id
  for update;

  if not found then
    if p_delta < 0 then
      raise exception 'Stock insuficiente: no hay existencias registradas para este artículo en esta bodega.';
    end if;
    insert into sgc.stock_por_bodega (articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, p_delta, now());
  else
    if v_actual + p_delta < 0 then
      raise exception 'Stock insuficiente: disponible %, solicitado %.', v_actual, abs(p_delta);
    end if;
    update sgc.stock_por_bodega
    set cantidad = v_actual + p_delta, updated_at = now()
    where articulo_id = p_articulo_id and bodega_id = p_bodega_id;
  end if;
end;
$function$;
