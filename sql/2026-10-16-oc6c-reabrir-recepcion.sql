-- QA-OC6c — reabrir una orden marcada "recibida" sin recepción real.
--
-- OC-202610-0006 (el caso de Raykler) quedó en estado 'recibida' por un flip
-- manual del dropdown de estado, sin que nunca se registrara una sola entrada
-- real (0 entradas_inventario ligadas, ambos renglones "sin artículo"). Como
-- 'recibida' es terminal (sgc.actualizar_estado_orden no permite salir de ahí)
-- y Inventario > Entradas solo ofrece OCs en estado aprobada|recibida_parcial
-- (entradas.ts: ordenesRecibibles), la orden queda bloqueada para siempre: el
-- fix de QA-OC6 (precarga + picker buscable + vincular artículo) no alcanza
-- a una orden que ya está en este estado terminal.
--
-- Esto agrega la única transición que faltaba — recibida -> recibida_parcial
-- ("reabrir recepción") — para que una orden marcada por error (o cuya
-- recepción real todavía no terminó) pueda volver a aparecer en Entradas.
-- El botón en el front (ordenes.ts/html) solo se muestra cuando la
-- reconciliación tiene algún renglón no "completo", así que no invita a
-- reabrir órdenes que sí se recibieron de verdad.

create or replace function sgc.actualizar_estado_orden(p_orden_id uuid, p_nuevo_estado text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_actual text;
  v_permitido boolean;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then
    raise exception 'No autorizado para cambiar el estado de esta orden.';
  end if;

  select estado into v_actual from sgc.ordenes_compra where id = p_orden_id for update;
  if not found then
    raise exception 'Orden no encontrada.';
  end if;

  v_permitido := case v_actual
    when 'borrador' then p_nuevo_estado in ('aprobada', 'cancelada')
    when 'aprobada' then p_nuevo_estado in ('recibida', 'recibida_parcial', 'cancelada')
    when 'recibida_parcial' then p_nuevo_estado in ('recibida', 'cancelada')
    when 'recibida' then p_nuevo_estado in ('recibida_parcial')
    else false
  end;

  if not v_permitido then
    raise exception 'No se puede cambiar de "%" a "%".', v_actual, p_nuevo_estado;
  end if;

  update sgc.ordenes_compra set estado = p_nuevo_estado, updated_at = now() where id = p_orden_id;
end;
$$;

grant execute on function sgc.actualizar_estado_orden(uuid, text) to authenticated;
