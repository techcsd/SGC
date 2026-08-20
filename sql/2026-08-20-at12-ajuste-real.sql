-- ============================================================================
-- AT12 — "Ajuste real" de almacenes (opción A: el número informado ES el stock
-- actual real). Fija el stock final a la cantidad real SIN generar movimiento en
-- el kardex ni escalón en la gráfica — rebasa la LÍNEA BASE (apertura) para que
-- el stock quede exactamente en el valor real:
--    stock = apertura + Σmovimientos  ⇒  apertura := real − Σmovimientos
-- Como Σmovimientos puede exceder el conteo real (p.ej. salidas no registradas al
-- 100%), la línea base interna puede quedar NEGATIVA — es invisible al usuario y
-- mantiene el stock exacto. Por eso se relaja el check ≥0 de stock_apertura.
-- Solo admin; queda traza interna (vía _aplicar_apertura → sgc.auditoria).
-- ============================================================================
set search_path = sgc, public;

-- Permitir base interna negativa (necesario para fijar el stock exacto en opción A).
alter table sgc.stock_apertura drop constraint if exists stock_apertura_cantidad_check;

-- Ajuste real de UN artículo/almacén.
create or replace function sgc.ajuste_real_stock(
  p_articulo_id uuid, p_bodega_id uuid, p_cantidad_real numeric
) returns void
language plpgsql security definer set search_path = sgc, public as $$
declare v_sigma numeric;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede hacer el ajuste real' using errcode = '42501';
  end if;
  if p_cantidad_real is null or p_cantidad_real < 0 then
    raise exception 'La cantidad real no puede ser negativa' using errcode = 'AT400';
  end if;
  v_sigma := sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id);
  -- Rebase de la base: apertura := real − Σmovimientos ⇒ stock final = real, sin
  -- movimiento ni escalón (reutiliza el core de apertura AP5/AU6, que además audita).
  perform sgc._aplicar_apertura(p_articulo_id, p_bodega_id, p_cantidad_real - v_sigma, auth.uid());
end;
$$;
grant execute on function sgc.ajuste_real_stock(uuid, uuid, numeric) to authenticated, service_role;

-- Ajuste real en LOTE (para la carga por archivo). p_rows: [{articulo_id, cantidad}].
create or replace function sgc.ajuste_real_lote(p_bodega_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = sgc, public as $$
declare v_row jsonb; v_i int := 0; v_ok int := 0; v_err jsonb := '[]'::jsonb; v_art uuid; v_cant numeric;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede hacer el ajuste real' using errcode = '42501';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    begin
      v_art := nullif(v_row->>'articulo_id','')::uuid;
      v_cant := (v_row->>'cantidad')::numeric;
      if v_art is null then
        v_err := v_err || jsonb_build_object('fila', v_i, 'msg', 'Sin artículo'); continue;
      end if;
      perform sgc.ajuste_real_stock(v_art, p_bodega_id, v_cant);
      v_ok := v_ok + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('fila', v_i, 'articulo_id', v_row->>'articulo_id', 'msg', SQLERRM);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errores', v_err);
end;
$$;
grant execute on function sgc.ajuste_real_lote(uuid, jsonb) to authenticated, service_role;

-- ── El ingeniero de obra debe poder crear requisiciones desde la web → módulo compras ─
update sgc.roles
   set modulos = array_append(modulos, 'compras')
 where codigo = 'ingeniero_campo' and not ('compras' = any(modulos));
