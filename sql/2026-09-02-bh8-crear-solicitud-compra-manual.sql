-- ════════════════════════════════════════════════════════════════════════════
-- BH8 — Solicitud de compra manual: ampliar crear_solicitud_compra para que
--   pueda enlazarse a una requisición (origen_requisicion_id) y llevar categoría,
--   y añadir la comprobación de autorización explícita que sus hermanas
--   (aprobar/rechazar) sí tienen.
--
-- SE DROPEA la firma 4-arg y se crea una sola 6-arg con defaults nulos → la
-- llamada 4-named-arg del front sigue funcionando y NO queda un par de sobrecargas
-- que PostgREST no pueda desambiguar (lección incentivo_listado / AY6).
--
-- Los estados de solicitudes_compra NO cambian (pendiente|convertida|rechazada):
-- la manual nace 'pendiente'. Si en el futuro necesita 'borrador'/'cancelada',
-- el constraint se amplía en la MISMA migración (regla 3 del checklist, BG5).
-- ════════════════════════════════════════════════════════════════════════════

begin;
set local search_path = sgc, public;

drop function if exists sgc.crear_solicitud_compra(uuid, uuid, text, jsonb);

create or replace function sgc.crear_solicitud_compra(
  p_proyecto_id uuid,
  p_solicitante_id uuid,
  p_notas text,
  p_items jsonb,
  p_origen_requisicion_id uuid default null,  -- BH8 — traza cuando nace de una requisición
  p_categoria text default null               -- BH8 — p.ej. 'tecnologia'
)
returns uuid
language plpgsql
as $$
declare
  v_solicitud_id uuid;
begin
  -- BH8 — autorización explícita (antes todo dependía de la RLS solicitante = uid).
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if p_solicitante_id <> auth.uid() and not sgc.is_admin() then
    raise exception 'Solo puedes crear solicitudes de compra a tu propio nombre.';
  end if;

  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, notas, origen_requisicion_id, categoria)
  values (p_proyecto_id, p_solicitante_id, p_notas, p_origen_requisicion_id, nullif(btrim(p_categoria), ''))
  returning id into v_solicitud_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido)
  select v_solicitud_id, i->>'descripcion', (i->>'cantidad')::numeric, i->>'proveedor_sugerido'
  from jsonb_array_elements(p_items) as i;

  return v_solicitud_id;
end;
$$;

grant execute on function sgc.crear_solicitud_compra(uuid, uuid, text, jsonb, uuid, text) to authenticated;

commit;
