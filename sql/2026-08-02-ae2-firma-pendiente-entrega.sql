-- ============================================================================
-- AE — Firma de RECEPTOR pendiente enrutada también en la ENTREGA de conduces.
-- ----------------------------------------------------------------------------
-- Extiende el modelo de "firma pendiente" (ya usado en la devolución) a la entrega
-- de conduces: si el ingeniero/encargado que recibe NO está presente, el chofer
-- entrega igual (el conduce queda entregado) y la firma del receptor queda
-- PENDIENTE, asignada a esa persona, que la firma después en "Por firmar".
--
-- `entregar_conduce` ya acepta firma nula (solo guarda entrega_firma_path); el
-- receptor firma luego por `firmar_conduce` (ya ampliado para el asignado). Aquí
-- solo agregamos el RPC que ASIGNA la firma pendiente a un usuario + le avisa.
-- Idempotente.
-- ============================================================================

set search_path = sgc, public;

create or replace function sgc.asignar_firma_pendiente(
  p_salida_id uuid,
  p_usuario_id uuid,
  p_nombre text
) returns void
language plpgsql
security definer
set search_path to 'sgc','pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_usuario_id is null then raise exception 'Falta a quién asignar la firma.'; end if;
  -- Gate: elevado (flota/inventario/admin) o creador/conductor de la salida.
  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota') or sgc.tiene_modulo('inventario')
    or exists (select 1 from sgc.salidas_inventario s where s.id = p_salida_id
               and (s.creado_por = v_uid
                    or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = v_uid)))
  ) then
    raise exception 'No autorizado para asignar esta firma.';
  end if;

  update sgc.salidas_inventario
     set firma_pendiente_usuario_id = p_usuario_id,
         firma_pendiente_nombre = nullif(trim(p_nombre),'')
   where id = p_salida_id;

  perform sgc.notificar(p_usuario_id, 'firma',
    'Firma de recepción pendiente',
    'Tienes una entrega de material por firmar.',
    '/transporte/por-firmar');
end;
$$;
grant execute on function sgc.asignar_firma_pendiente(uuid, uuid, text) to authenticated, service_role;
