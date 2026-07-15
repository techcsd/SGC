-- ============================================================================
-- Actualización 2 — FASE 5 (Inventario/Tecnología). Cambio de BD: U17.
-- U17 — foto en inventario tecnológico. La foto se guarda en el bucket privado
-- `inventario` (path tec-equipo/{id}/…); aquí solo se agrega el path en la fila.
-- U16 (vista v_movimientos_inventario), U22 (bodegas.latitud/longitud) y U5
-- (normalizar_telefono) ya están en la migración de FASE 1.
-- ============================================================================
set search_path = sgc, public;

alter table sgc.tec_equipos add column if not exists foto_path text;

-- U17 (cont.) — foto por renglón de compra tecnológica. Aditivo: los renglones
-- viejos quedan con foto_path null. La foto se sube al mismo bucket `inventario`
-- (path compra-tec/{uuid}.jpg) y aquí se guarda su path.
alter table sgc.solicitud_compra_items add column if not exists foto_path text;

-- Extiende la RPC para leer foto_path del item (retrocompatible: si el JSON no
-- trae foto_path, queda null; la firma text/jsonb no cambia → llamadas viejas OK).
create or replace function sgc.crear_solicitud_compra_tec(
  p_notas text,
  p_items jsonb   -- [{descripcion, cantidad, proveedor_sugerido, foto_path?}]
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('tecnologia')) then
    raise exception 'No autorizado para crear compras tecnológicas.';
  end if;

  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, estado, notas, categoria)
  values (null, auth.uid(), 'pendiente', p_notas, 'tecnologia')
  returning id into v_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, foto_path)
  select v_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido', i->>'foto_path'
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  return v_id;
end;
$$;
grant execute on function sgc.crear_solicitud_compra_tec(text, jsonb) to authenticated, service_role;
