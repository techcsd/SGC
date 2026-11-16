-- W3 (DS-06, ronda DS 16-nov-2026): nombre de la cuenta analitica de Odoo. ADITIVA, SOLO DEV hasta OK.
-- 1) proyecto_odoo_analiticas.odoo_analytic_nombre: lo llena la homologacion (data-fix o RPC admin), nunca se infiere por nombre.
-- 2) proyecto_cuentas_analiticas_para_oc devuelve tambien el nombre (cambia el tipo de retorno: se recrea).
-- 3) odoo_analitica_nombre_registrar(id, nombre): admin / Tecnologia lo fija en la homologacion.
-- Reversa: sql/_reversa/2026-11-16-w3a-cuenta-analitica-nombre.reversa.sql
begin;

alter table sgc.proyecto_odoo_analiticas add column if not exists odoo_analytic_nombre text;
comment on column sgc.proyecto_odoo_analiticas.odoo_analytic_nombre is 'W3 nombre de la cuenta analitica en Odoo (copia informativa, se llena en la homologacion)';

drop function if exists sgc.proyecto_cuentas_analiticas_para_oc(uuid);
create function sgc.proyecto_cuentas_analiticas_para_oc(p_proyecto_id uuid)
returns table (odoo_analytic_id bigint, rol text, confirmado boolean, nombre text)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
  select a.odoo_analytic_id, a.rol, a.confirmado, a.odoo_analytic_nombre
    from sgc.proyecto_odoo_analiticas a
    join sgc.odoo_instancias i on i.id = a.odoo_instancia_id and i.habilitada
   where a.proyecto_id = p_proyecto_id
   order by (a.rol = 'principal') desc, a.odoo_analytic_id;
end $fn$;
revoke all on function sgc.proyecto_cuentas_analiticas_para_oc(uuid) from public, anon;
grant execute on function sgc.proyecto_cuentas_analiticas_para_oc(uuid) to authenticated, service_role;

create or replace function sgc.odoo_analitica_nombre_registrar(p_id uuid, p_nombre text)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia() or auth.role() = 'service_role') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_nombre is not null and length(btrim(p_nombre)) not between 1 and 200 then
    raise exception 'El nombre debe tener entre 1 y 200 caracteres' using errcode = '22023';
  end if;
  update sgc.proyecto_odoo_analiticas set odoo_analytic_nombre = nullif(btrim(p_nombre), '') where id = p_id;
  if not found then raise exception 'Cuenta analitica no encontrada' using errcode = 'P0002'; end if;
end $fn$;
revoke all on function sgc.odoo_analitica_nombre_registrar(uuid, text) from public, anon;
grant execute on function sgc.odoo_analitica_nombre_registrar(uuid, text) to authenticated, service_role;

commit;
