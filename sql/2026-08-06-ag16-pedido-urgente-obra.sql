-- AG16 / PROMPT-8 — el gerente de producción hace "pedido urgente" desde el módulo
-- Obra, pero no tiene el módulo `compras`. Relajamos el gate de crear_solicitud_app
-- para aceptar también acceso Obra (submódulo plan_dia u obra). El scoping fino por
-- proyecto lo sigue haciendo requisicion_permitida(). Aditivo (solo amplía quién puede).

set search_path = sgc, public;

create or replace function sgc.crear_solicitud_app(p_id uuid, p_proyecto_id uuid, p_urgencia text, p_notas text, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (
    sgc.tiene_modulo('compras')
    or sgc.tiene_modulo('obra')
    or sgc.puede_operar_submodulo('obra.plan_dia')
  ) then
    raise exception 'Tu usuario no tiene el módulo Solicitudes ni acceso a Obra';
  end if;
  if exists (select 1 from sgc.solicitudes_material where id = p_id) then
    return p_id;  -- idempotente: reenvío de op ya aceptada
  end if;
  if not sgc.requisicion_permitida(p_proyecto_id, auth.uid()) then
    raise exception 'Solo el Ingeniero Residente/Responsable asignado a la obra puede crear requisiciones.';
  end if;

  insert into sgc.solicitudes_material (id, proyecto_id, solicitante_id, estado, urgencia, notas)
  values (p_id, p_proyecto_id, auth.uid(), 'pendiente', coalesce(p_urgencia, 'normal'), p_notas);
  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad)
  select p_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion', (i->>'cantidad')::numeric, i->>'unidad'
  from jsonb_array_elements(p_items) as i;
  return p_id;
end;
$function$;
