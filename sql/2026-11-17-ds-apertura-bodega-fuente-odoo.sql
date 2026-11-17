-- 2026-11-17 -- DS-29: el conteo fisico aplicado (y todo ajuste de existencia) pasa por sgc._aplicar_apertura, que escribia stock_por_bodega
-- directo y el bloqueo tg_stock_por_bodega_fuente_odoo lo rechazaba en las bodegas con fuente Odoo (hallazgo de la prueba real en prod).
-- Igual que adjust_stock: en una bodega con fuente Odoo el cambio se aplica como PROYECCION OPTIMISTA y Odoo (conteo -> inventory_quantity,
-- publicado por el outbox) manda y corrige en el sondeo.
create or replace function sgc._aplicar_apertura(p_articulo_id uuid, p_bodega_id uuid, p_cantidad numeric, p_actor uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_sigma   numeric;
  v_current numeric;
  v_old     numeric;
  v_target  numeric;
  v_fuente  boolean;
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

  v_fuente := exists (select 1 from sgc.odoo_corte_bodega where bodega_id = p_bodega_id and fuente_odoo);
  if v_fuente then perform set_config('sgc.odoo_proyectando', 'true', true); end if;
  insert into sgc.stock_por_bodega(articulo_id, bodega_id, cantidad, updated_at)
    values (p_articulo_id, p_bodega_id, v_target, now())
  on conflict (articulo_id, bodega_id)
    do update set cantidad = v_target, updated_at = now();
  if v_fuente then perform set_config('sgc.odoo_proyectando', 'false', true); end if;

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
