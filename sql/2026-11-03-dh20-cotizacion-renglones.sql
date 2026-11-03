-- DH20 — `leer-cotizacion` YA extraía los renglones (`lectura.articulos`) pero
-- el front los descartaba (solo usaba proveedor/fecha/moneda/total) y no había
-- forma de guardarlos editados. En vez de una tabla relacional nueva (que solo
-- hace falta para "proponer equipos"/"comparar precios", fuera de alcance esta
-- ronda), se guardan y editan dentro del mismo jsonb `lectura.articulos` que ya
-- existe — aditivo, sin tocar cotizacion_actualizar.

create or replace function sgc.cotizacion_actualizar_renglones(p_id uuid, p_articulos jsonb)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'public'
as $function$
begin
  if not sgc.puede_operar_submodulo('tecnologia.cotizaciones') then
    raise exception 'No autorizado para editar cotizaciones.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc.tec_cotizaciones where id = p_id) then
    raise exception 'Cotización no encontrada.';
  end if;
  if jsonb_typeof(p_articulos) <> 'array' then
    raise exception 'Los renglones deben ser una lista.' using errcode = '22023';
  end if;

  update sgc.tec_cotizaciones
     set lectura = coalesce(lectura, '{}'::jsonb) || jsonb_build_object('articulos', p_articulos),
         updated_at = now()
   where id = p_id;
end;
$function$;

grant execute on function sgc.cotizacion_actualizar_renglones(uuid, jsonb) to authenticated;
