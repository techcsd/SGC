-- CF7b — Configuración legal editable por legal/abogado (no solo admin)
-- -------------------------------------------------------------------------------------
-- La política de UPDATE de `empresa` es solo is_admin(). Para que Sonia (legal) sea
-- independiente, un RPC definer deja a legal/admin guardar los datos del empleador y los
-- testigos frecuentes que usan los contratos. Lectura: `empresa` ya es legible por todos.
-- -------------------------------------------------------------------------------------

create or replace function sgc.guardar_config_legal(
  p_razon_social text default null,
  p_rnc text default null,
  p_direccion text default null,
  p_ciudad text default null,
  p_representante text default null,
  p_gerente_general text default null,
  p_testigos jsonb default null
) returns void
language plpgsql security definer set search_path to 'sgc','pg_temp'
as $function$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('legal')) then
    raise exception 'Solo Legal o Administración pueden editar la configuración legal' using errcode='42501';
  end if;
  update sgc.empresa set
    razon_social     = coalesce(p_razon_social, razon_social),
    rnc              = coalesce(p_rnc, rnc),
    direccion        = coalesce(p_direccion, direccion),
    ciudad           = coalesce(p_ciudad, ciudad),
    representante    = coalesce(p_representante, representante),
    gerente_general  = coalesce(p_gerente_general, gerente_general),
    testigos_frecuentes = coalesce(p_testigos, testigos_frecuentes),
    updated_at       = now()
  where id = (select id from sgc.empresa order by id limit 1);
end;
$function$;
grant execute on function sgc.guardar_config_legal(text, text, text, text, text, text, jsonb) to authenticated;
