-- CY24d (propuesta, PROMPT-119 FASE A4) — RPC de solo lectura para que el
-- solicitante ORIGINAL de una solicitud de compra (app móvil) vea el estado
-- Odoo de la OC en la que se convirtió, sin exponer IDs de Odoo.
--
-- Por qué hace falta (diagnosticado en vivo contra dev, 26-oct-2026):
-- 1) `sgc.solicitudes_compra.orden_compra_id` SÍ enlaza a la OC resultante
--    (sql/2026-07-12-requisiciones-flujo.sql), pero la política de SELECT de
--    `sgc.ordenes_compra` (sql/2026-07-03-po-receiving.sql:24-25) solo deja
--    ver la fila a admin / módulo `compras` / módulo `inventario`. Un
--    solicitante de campo normal (capataz/ingeniero) no tiene ninguno de los
--    tres, así que no puede leer `odoo_sync_estado` directo aunque la app
--    tuviera una pantalla para pintarlo.
-- 2) `sgc.odoo_producto_solicitudes` tiene RLS que deja ver `solicitado_por =
--    auth.uid()` (sql/2026-10-26-cy24-oc-odoo-a.sql) — pero ese
--    `solicitado_por` es quien crea la OC en la web (Compras, al toparse con
--    un renglón sin producto Odoo), NO el solicitante original de la app.
--    La app nunca es dueña de esa fila, así que tampoco puede leerla directo.
--
-- Esta función es SECURITY DEFINER, filtra TODO por `sc.solicitante_id =
-- auth.uid()` adentro (no delega en RLS de las tablas que junta), y solo
-- devuelve 3 textos sin jerga + el estado de una eventual alta de producto —
-- nunca `odoo_id`/`odoo_product_id`/nombres internos de Odoo (BS2: nada
-- técnico a quien no sea esDesarrollador — ese gate es cosa de la UI app,
-- esta función ya no expone el dato crudo de por sí).
--
-- Entorno: aplicar primero en dev, probar con una solicitud real convertida a
-- OC con el piloto (`odoo_compras_piloto_habilitado`) encendido, luego prod
-- (regla 18). Mientras el piloto siga apagado globalmente, todas las
-- solicitudes devuelven `odoo_estado: null` (sin OC con sync, nada que
-- mostrar) — comportamiento idéntico al de hoy (CY24-1).

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
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;

  select * into v_solicitud
  from sgc.solicitudes_compra
  where id = p_solicitud_id and solicitante_id = auth.uid();

  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'PGRST';
  end if;

  if v_solicitud.orden_compra_id is null then
    -- Aún no se convirtió en OC — nada de Odoo que reportar (estado normal
    -- de 'pendiente'/'rechazada', ya lo muestra mis_solicitudes_compra_app).
    return jsonb_build_object('odoo_estado', null, 'alta_producto_estado', null);
  end if;

  select * into v_oc from sgc.ordenes_compra where id = v_solicitud.orden_compra_id;

  v_odoo_estado := case v_oc.odoo_sync_estado
    when 'pendiente_producto' then 'pendiente de producto'
    when 'publicada' then 'publicada'
    when 'conflicto' then 'en conflicto'
    else null  -- piloto apagado o fila dormida: no inventar un estado.
  end;

  -- ¿Alguna línea de esta OC tiene una solicitud de alta de producto sin
  -- resolver? No importa quién la creó (Compras) — el dueño de la OC puede
  -- ver que existe, sin ver el detalle interno de Odoo.
  select ops.* into v_alta_pendiente
  from sgc.odoo_producto_solicitudes ops
  join sgc.orden_compra_items oci on oci.id = ops.orden_item_id
  where oci.orden_id = v_oc.id
  order by ops.solicitado_en desc
  limit 1;

  return jsonb_build_object(
    'odoo_estado', v_odoo_estado,
    'alta_producto_estado', case when v_alta_pendiente.id is null then null
      else v_alta_pendiente.estado end,
    'alta_producto_motivo', case when v_alta_pendiente.estado = 'rechazada'
      then v_alta_pendiente.motivo_resolucion else null end
  );
end;
$$;

comment on function sgc.mi_solicitud_compra_odoo_estado(uuid) is
  'CY24d (PROMPT-119 A4) -- estado Odoo de una solicitud de compra, para el solicitante original. Sin IDs de Odoo.';

grant execute on function sgc.mi_solicitud_compra_odoo_estado(uuid) to authenticated;

commit;
