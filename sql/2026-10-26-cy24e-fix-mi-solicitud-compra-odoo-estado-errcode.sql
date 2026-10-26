-- CY24e — fix de cy24d: `mi_solicitud_compra_odoo_estado` usaba
-- `using errcode = 'PGRST'` para la rama "solicitud no encontrada / no es
-- tuya", un código inventado que no es un SQLSTATE válido. PostgREST
-- interpreta cualquier excepción cuyo SQLSTATE empiece con 'PGRST' como un
-- mensaje de error YA FORMATEADO EN JSON (su propio convenio interno de
-- passthrough) e intenta parsear el texto plano como JSON → falla y devuelve
-- un 500 confuso (PGRST121) en vez de un 4xx limpio.
--
-- Encontrado probando el RPC en vivo contra dev (no en el build, que no
-- ejecuta SQL) con una solicitud inexistente/ajena. Se quita el `errcode`
-- inventado — sin él, cae en el camino normal de excepción de PL/pgSQL
-- (P0001), exactamente como ya funciona bien la rama "No autenticado." de la
-- misma función. No se reescribe cy24d (ya aplicada) — create or replace
-- nuevo, migración nueva, mismo patrón que usa el resto de esta ronda.
--
-- Entorno: dev primero, luego prod cuando se promueva el resto de CY24d.

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
    raise exception 'Solicitud no encontrada.';
  end if;

  if v_solicitud.orden_compra_id is null then
    return jsonb_build_object('odoo_estado', null, 'alta_producto_estado', null, 'alta_producto_motivo', null);
  end if;

  select * into v_oc from sgc.ordenes_compra where id = v_solicitud.orden_compra_id;

  v_odoo_estado := case v_oc.odoo_sync_estado
    when 'pendiente_producto' then 'pendiente de producto'
    when 'publicada' then 'publicada'
    when 'conflicto' then 'en conflicto'
    else null
  end;

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

grant execute on function sgc.mi_solicitud_compra_odoo_estado(uuid) to authenticated;

commit;
