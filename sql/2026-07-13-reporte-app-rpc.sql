-- Reporte (duda/error/mejora) desde la CSD App — offline idempotente.
set search_path = sgc, public;
create or replace function sgc.crear_reporte_app(p_id uuid, p_tipo text, p_asunto text, p_descripcion text)
returns uuid language plpgsql security definer set search_path to 'sgc','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if exists (select 1 from sgc.reportes_usuario where id = p_id) then return p_id; end if;
  insert into sgc.reportes_usuario (id, usuario_id, tipo, asunto, descripcion, estado)
  values (p_id, auth.uid(), coalesce(nullif(p_tipo,''),'error'), coalesce(nullif(p_asunto,''),'Reporte desde la app'), p_descripcion, 'abierto');
  return p_id;
end; $$;
grant execute on function sgc.crear_reporte_app(uuid, text, text, text) to authenticated, service_role;
