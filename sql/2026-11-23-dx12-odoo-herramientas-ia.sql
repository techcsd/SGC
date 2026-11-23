-- DX12.3 (ronda 23-nov-2026) -- interruptor de las herramientas Odoo de solo lectura para Compa/MCP. APAGADO por defecto.
begin;
insert into sgc.parametros (clave, valor, descripcion) values
  ('odoo_herramientas_ia', 'false', 'DX12.3 — permite a Compa y al conector consultar stock/OC/estado de sincronización en Odoo (solo lectura). Apagado hasta probar en dev.')
on conflict (clave) do nothing;

create or replace function sgc.odoo_herramientas_ia_activo()
returns boolean language sql stable security definer set search_path to 'sgc', 'pg_temp'
as $$ select coalesce((select lower(valor) in ('true','t','1','si','sí') from sgc.parametros where clave = 'odoo_herramientas_ia'), false); $$;
revoke all on function sgc.odoo_herramientas_ia_activo() from public, anon;
grant execute on function sgc.odoo_herramientas_ia_activo() to authenticated, service_role;

-- Estado de la sincronización para la herramienta estado_sincronizacion_odoo (odoo_intentos no es legible por usuarios).
create or replace function sgc.odoo_estado_sincronizacion()
returns jsonb language plpgsql stable security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then raise exception 'sin_permiso' using errcode = '42501'; end if;
  return jsonb_build_object(
    'ultimo_intento_ok', (select max(finalizado_en) from sgc.odoo_intentos where estado_resultado = 'ok'),
    'intentos_con_error_24h', (select count(*) from sgc.odoo_intentos where estado_resultado <> 'ok' and reclamado_en > now() - interval '24 hours'),
    'conduces_degradados', (select count(*) from sgc.odoo_conduces_degradados));
end;
$$;
revoke all on function sgc.odoo_estado_sincronizacion() from public, anon;
grant execute on function sgc.odoo_estado_sincronizacion() to authenticated;
commit;
