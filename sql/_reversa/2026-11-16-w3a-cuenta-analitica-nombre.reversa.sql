-- Reversa de W3a: restaura proyecto_cuentas_analiticas_para_oc (3 columnas), borra la RPC de nombre y la columna.
begin;
drop function if exists sgc.odoo_analitica_nombre_registrar(uuid, text);
drop function if exists sgc.proyecto_cuentas_analiticas_para_oc(uuid);
create function sgc.proyecto_cuentas_analiticas_para_oc(p_proyecto_id uuid)
returns table (odoo_analytic_id bigint, rol text, confirmado boolean)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select a.odoo_analytic_id, a.rol, a.confirmado
    from sgc.proyecto_odoo_analiticas a
    join sgc.odoo_instancias i on i.id = a.odoo_instancia_id and i.habilitada
   where a.proyecto_id = p_proyecto_id
   order by (a.rol = 'principal') desc, a.odoo_analytic_id;
end $fn$;
revoke all on function sgc.proyecto_cuentas_analiticas_para_oc(uuid) from public, anon;
grant execute on function sgc.proyecto_cuentas_analiticas_para_oc(uuid) to authenticated, service_role;
alter table sgc.proyecto_odoo_analiticas drop column if exists odoo_analytic_nombre;
commit;
