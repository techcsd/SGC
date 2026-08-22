-- AU1 · P1 — Integridad del stock: un solo punto de "Ajustar existencia" con MOTIVO auditado.
--
-- Hallazgo de la auditoría (Entregable 3, P1): tres mecanismos distintos fijan/mueven
-- la MISMA existencia y se ofrecían a la vez, sin obligar a decir por qué:
--   · ajustar_stock_articulo  → conteo/ajuste, deja movimiento en el kardex (ya tenía p_motivo)
--   · set_apertura (AP5)       → rebase de la línea base, SIN movimiento
--   · ajuste_real_stock (AT12) → fija el stock al real contado, SIN movimiento ni escalón
-- Dos caminos para cambiar el mismo número sin razón = dos verdades. La web ahora los
-- unifica en un solo modal "Ajustar existencia" con selector de mecanismo + motivo; esta
-- migración hace que los DOS que faltaban acepten y AUDITEN ese motivo.
--
-- Aditivo y retrocompatible: p_motivo es opcional (default null); los callers viejos
-- (set_apertura_lote, apertura de catálogo AU6, etc.) siguen funcionando sin cambios
-- porque el parámetro nuevo va al final con default.

-- ── _aplicar_apertura: +p_motivo (lo agrega al jsonb de auditoría) ────────────
drop function if exists sgc._aplicar_apertura(uuid, uuid, numeric, uuid);
create function sgc._aplicar_apertura(
  p_articulo_id uuid, p_bodega_id uuid, p_cantidad numeric,
  p_actor uuid default null, p_motivo text default null
) returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $function$
declare
  v_sigma   numeric;
  v_current numeric;
  v_old     numeric;
  v_target  numeric;
begin
  if p_cantidad is null or p_cantidad < 0 then
    raise exception 'La cantidad de apertura debe ser mayor o igual a 0.';
  end if;

  v_sigma   := sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id);
  v_current := coalesce((select cantidad from sgc.stock_por_bodega
                          where articulo_id = p_articulo_id and bodega_id = p_bodega_id), 0);
  v_old     := sgc.apertura_efectiva(p_articulo_id, p_bodega_id);
  v_target  := p_cantidad + v_sigma;

  if v_target < 0 then
    raise exception 'No puedes fijar la apertura en %: el almacén ya consumió más que eso (el disponible caería a %).',
      p_cantidad, v_target;
  end if;
  if v_target = v_current
     and exists (select 1 from sgc.stock_apertura
                 where articulo_id = p_articulo_id and bodega_id = p_bodega_id
                   and cantidad = p_cantidad) then
    return;  -- sin cambio
  end if;

  insert into sgc.stock_apertura(articulo_id, bodega_id, cantidad, updated_at, updated_by)
    values (p_articulo_id, p_bodega_id, p_cantidad, now(), p_actor)
  on conflict (articulo_id, bodega_id)
    do update set cantidad = excluded.cantidad, updated_at = now(), updated_by = p_actor;

  insert into sgc.stock_por_bodega(articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, v_target, now())
  on conflict (articulo_id, bodega_id)
    do update set cantidad = v_target, updated_at = now();

  insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios, datos_antes, datos_despues)
    values ('stock_apertura',
            p_articulo_id::text || ':' || p_bodega_id::text,
            'UPDATE', p_actor,
            jsonb_build_object('op', 'set_apertura', 'delta_stock', v_target - v_current)
              || case when coalesce(trim(p_motivo), '') <> ''
                      then jsonb_build_object('motivo', p_motivo) else '{}'::jsonb end,
            jsonb_build_object('apertura', v_old),
            jsonb_build_object('apertura', p_cantidad));
end;
$function$;

-- ── set_apertura (AP5): +p_motivo ────────────────────────────────────────────
drop function if exists sgc.set_apertura(uuid, uuid, numeric);
create function sgc.set_apertura(p_articulo_id uuid, p_bodega_id uuid, p_cantidad numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp' as $function$
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede editar el dato de apertura.' using errcode = '42501';
  end if;
  perform sgc._aplicar_apertura(p_articulo_id, p_bodega_id, p_cantidad, auth.uid(),
                                coalesce(nullif(trim(p_motivo), ''), 'Ajuste de apertura'));
end;
$function$;

-- ── ajuste_real_stock (AT12): +p_motivo ──────────────────────────────────────
drop function if exists sgc.ajuste_real_stock(uuid, uuid, numeric);
create function sgc.ajuste_real_stock(p_articulo_id uuid, p_bodega_id uuid, p_cantidad_real numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'sgc', 'public' as $function$
declare v_sigma numeric;
begin
  if not sgc.is_admin() then
    raise exception 'Solo un administrador puede hacer el ajuste real' using errcode = '42501';
  end if;
  if p_cantidad_real is null or p_cantidad_real < 0 then
    raise exception 'La cantidad real no puede ser negativa' using errcode = 'AT400';
  end if;
  v_sigma := sgc.stock_movimientos_sigma(p_articulo_id, p_bodega_id);
  perform sgc._aplicar_apertura(p_articulo_id, p_bodega_id, p_cantidad_real - v_sigma, auth.uid(),
                                coalesce(nullif(trim(p_motivo), ''), 'Ajuste real de existencia'));
end;
$function$;

-- Grants (DROP+CREATE cambia la firma → re-otorgar EXECUTE; gotcha recurrente).
grant execute on function sgc.set_apertura(uuid, uuid, numeric, text) to authenticated;
grant execute on function sgc.ajuste_real_stock(uuid, uuid, numeric, text) to authenticated;
