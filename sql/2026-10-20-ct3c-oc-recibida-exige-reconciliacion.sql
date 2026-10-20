-- 2026-10-20-ct3c-oc-recibida-exige-reconciliacion.sql — CT3 parte c (fila 263)
-- Repite QA-OC6/OC6c (OC-202610-0006, Raykler): una orden puede marcarse
-- "recibida" a mano (dropdown de estado) sin que el inventario haya recibido
-- nada de verdad — `sgc.actualizar_estado_orden` solo valida la máquina de
-- estados, nunca la reconciliación real. La reconciliación hoy solo existe en
-- el front (ordenes.ts `reconciliacion`/`reconciliacionIncompleta`, comparando
-- orden_compra_items vs detalle_entradas por articulo_id) — se replica aquí
-- del lado del servidor, con la MISMA lógica (suma todas las entradas ligadas
-- a la orden por `entradas_inventario.orden_compra_id`, igual que el front;
-- no excluye `rechazada` — comportamiento ya existente, no se cambia aquí).
-- Regla 19: la función de abajo es idéntica a la de prod (sql/2026-10-16-oc6c-
-- reabrir-recepcion.sql) salvo el bloqueo nuevo + el parámetro p_motivo.
begin;

alter table sgc.ordenes_compra add column if not exists motivo_recepcion_forzada text;
comment on column sgc.ordenes_compra.motivo_recepcion_forzada is
  'CT3c: motivo que un admin dio para marcar "recibida" con reconciliación incompleta — queda en sgc.auditoria vía el trigger genérico de UPDATE.';

-- Evita el overload ambiguo (gotcha recurrente, ver HANDOFF rondas CD/CH): el
-- 3er parámetro con default permitiría llamar con 2 args, chocando con la firma vieja.
drop function if exists sgc.actualizar_estado_orden(uuid, text);
create or replace function sgc.actualizar_estado_orden(p_orden_id uuid, p_nuevo_estado text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_actual text;
  v_permitido boolean;
  v_incompleta boolean;
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

  if p_nuevo_estado = 'recibida' then
    select exists (
      select 1 from sgc.orden_compra_items oi
       where oi.orden_id = p_orden_id
         and (
           oi.articulo_id is null
           or coalesce((
                select sum(de.cantidad) from sgc.detalle_entradas de
                  join sgc.entradas_inventario ei on ei.id = de.entrada_id
                 where ei.orden_compra_id = p_orden_id and de.articulo_id = oi.articulo_id
              ), 0) < oi.cantidad
         )
    ) into v_incompleta;

    if v_incompleta then
      if not (sgc.is_admin() and coalesce(btrim(p_motivo), '') <> '') then
        raise exception 'No se puede marcar "recibida": hay renglones sin recibir en el inventario. Usa "Registrar entrada de esta orden" o, si eres admin, da un motivo para forzarlo.' using errcode = '42501';
      end if;
      update sgc.ordenes_compra set motivo_recepcion_forzada = p_motivo where id = p_orden_id;
    end if;
  end if;

  update sgc.ordenes_compra set estado = p_nuevo_estado, updated_at = now() where id = p_orden_id;
end;
$$;

grant execute on function sgc.actualizar_estado_orden(uuid, text, text) to authenticated;

commit;
