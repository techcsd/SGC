-- ============================================================================
-- A7 — Compras tecnológicas: solicitud de compra sin proyecto + RPC dedicada.
-- Las compras de tecnología (laptops, cámaras, etc.) no se atan a una obra.
-- Aditivo: proyecto_id pasa a nullable (la app de campo no usa esta tabla).
-- ============================================================================
set search_path = sgc, public;

-- Permitir compras sin proyecto (tecnología / oficina).
alter table sgc.solicitudes_compra alter column proyecto_id drop not null;

create or replace function sgc.crear_solicitud_compra_tec(
  p_notas text,
  p_items jsonb   -- [{descripcion, cantidad, proveedor_sugerido}]
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

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido)
  select v_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido'
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  return v_id;
end;
$$;

grant execute on function sgc.crear_solicitud_compra_tec(text, jsonb) to authenticated, service_role;
