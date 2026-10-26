-- CY24f — segundo fix de cy24d/cy24e: los `case` de
-- `mi_solicitud_compra_odoo_estado` usaban valores que NO EXISTEN en los
-- CHECK constraints reales (verificado leyendo `sql/2026-10-26-cy24-oc-odoo-a.sql`,
-- no adivinado):
--
-- 1. `sgc.ordenes_compra.odoo_sync_estado` real: 'pendiente' | 'publicada' |
--    'confirmada' | 'cancelada' | 'error' | 'conflicto' (comentario de columna:
--    "NULL = nunca se intentó publicar"). El `case` de cy24d/e solo cubría
--    'pendiente_producto' (que NO es un valor de esta columna -- lo inventé
--    leyendo la prosa de la issue #24 "la OC queda en pendiente_producto",
--    que describe un estado DERIVADO, no un valor literal) y 'conflicto'/
--    'publicada' -- 'pendiente'/'confirmada'/'cancelada'/'error' caían todos
--    en `else null`, escondiendo un estado real como si nunca se hubiera
--    intentado publicar (viola el patrón BL2 de este repo: no tragarse un
--    estado real como "nada que mostrar").
-- 2. `sgc.odoo_producto_solicitudes.estado` real: 'pendiente' | 'creado' |
--    'vinculado_existente' | 'rechazado' (NO 'resuelta'/'rechazada' con 'a').
--    El chequeo `v_alta_pendiente.estado = 'rechazada'` nunca podía ser
--    verdadero -- `alta_producto_motivo` quedaba siempre null aunque hubiera
--    un rechazo real con motivo.
--
-- "pendiente de producto" (el texto que pide la issue #24/E3) es un estado
-- DERIVADO: existe una solicitud de alta de producto sin resolver
-- (`odoo_producto_solicitudes.estado = 'pendiente'`) en alguna línea de la
-- OC -- toma prioridad sobre `odoo_sync_estado` porque es la razón real por
-- la que la OC no puede avanzar.
--
-- No se reescriben cy24d/cy24e (ya aplicadas) -- create or replace nuevo,
-- mismo patrón del resto de la ronda. Reverificado en vivo contra dev tras
-- aplicar (ver HANDOFF).

begin;
set local search_path = sgc, public;

create or replace function sgc.mi_solicitud_compra_odoo_estado(p_solicitud_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_solicitud sgc.solicitudes_compra;
  v_oc sgc.ordenes_compra;
  v_alta_pendiente sgc.odoo_producto_solicitudes;
  v_odoo_estado text;
  v_alta_estado text;
  v_alta_motivo text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;

  select * into v_solicitud
  from sgc.solicitudes_compra
  where id = p_solicitud_id and solicitante_id = auth.uid();

  if not found then
    raise exception 'Solicitud no encontrada.';
  end if;

  if v_solicitud.orden_compra_id is null then
    return jsonb_build_object('odoo_estado', null, 'alta_producto_estado', null, 'alta_producto_motivo', null);
  end if;

  select * into v_oc from sgc.ordenes_compra where id = v_solicitud.orden_compra_id;

  -- La alta de producto sin resolver manda sobre el semáforo de sync: es la
  -- razón real por la que la OC está estancada.
  select ops.* into v_alta_pendiente
  from sgc.odoo_producto_solicitudes ops
  join sgc.orden_compra_items oci on oci.id = ops.orden_item_id
  where oci.orden_id = v_oc.id and ops.estado = 'pendiente'
  order by ops.solicitado_en desc
  limit 1;

  if v_alta_pendiente.id is not null then
    v_odoo_estado := 'pendiente de producto';
  else
    v_odoo_estado := case v_oc.odoo_sync_estado
      when 'pendiente' then 'pendiente de publicar'
      when 'publicada' then 'publicada'
      when 'confirmada' then 'confirmada'
      when 'cancelada' then 'cancelada'
      when 'error' then 'con un error de sincronización'
      when 'conflicto' then 'en conflicto'
      else null -- nunca se intentó publicar (comportamiento actual, CY24-1)
    end;
  end if;

  -- Última solicitud de alta de producto de esta OC, resuelta o no (para que
  -- el solicitante vea el desenlace aunque ya no esté "pendiente").
  select ops.* into v_alta_pendiente
  from sgc.odoo_producto_solicitudes ops
  join sgc.orden_compra_items oci on oci.id = ops.orden_item_id
  where oci.orden_id = v_oc.id
  order by ops.solicitado_en desc
  limit 1;

  v_alta_estado := case v_alta_pendiente.estado
    when 'pendiente' then 'pendiente'
    when 'creado' then 'resuelta'
    when 'vinculado_existente' then 'resuelta'
    when 'rechazado' then 'rechazada'
    else null
  end;
  v_alta_motivo := case when v_alta_pendiente.estado = 'rechazado' then v_alta_pendiente.motivo_resolucion else null end;

  return jsonb_build_object(
    'odoo_estado', v_odoo_estado,
    'alta_producto_estado', v_alta_estado,
    'alta_producto_motivo', v_alta_motivo
  );
end;
$$;

grant execute on function sgc.mi_solicitud_compra_odoo_estado(uuid) to authenticated;

commit;
