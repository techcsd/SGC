-- W2 (ronda DS, 16-nov-2026): lecturas/acciones ADITIVAS para la UI.
--  1) odoo_documento_sync_estado(tipo, id): estado de sync de UN documento (entrada/retiro/conteo/externo). Solo Tecnologia/admin.
--  2) proyecto_cuentas_analiticas_para_oc(proyecto): cuentas analiticas del proyecto para el selector al crear la OC (Compras/admin).
--  3) oc_elegir_cuenta_analitica(orden, cuenta): guarda ordenes_compra.odoo_analytic_elegida validando que pertenece a la obra.
begin;

create or replace function sgc.odoo_documento_sync_estado(p_tipo text, p_id uuid)
returns table (tipo text, documento_id uuid, estado text, error text, picking_id bigint, intentos integer, actualizado_en timestamptz)
language plpgsql stable security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_tipo not in ('entrada_inventario','retiro_material','conduce_externo','conteo_inventario') then
    raise exception 'tipo no soportado: %', p_tipo using errcode = '22023';
  end if;
  return query
  select p_tipo, u.id, u.odoo_sync_estado, u.odoo_sync_error, u.odoo_picking_id,
         coalesce((select max(e.intentos) from sgc.odoo_eventos e where e.agregado_tipo = p_tipo and e.agregado_id = p_id::text), 0)::integer,
         u.odoo_sync_en
  from (
    select id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.entradas_inventario where p_tipo = 'entrada_inventario' and id = p_id
    union all select id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.retiros_material where p_tipo = 'retiro_material' and id = p_id
    union all select id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.conduces_externos where p_tipo = 'conduce_externo' and id = p_id
    union all select id, odoo_sync_estado, odoo_sync_error, odoo_picking_id, odoo_sync_en from sgc.conteos_inventario where p_tipo = 'conteo_inventario' and id = p_id
  ) u;
end $fn$;
revoke all on function sgc.odoo_documento_sync_estado(text, uuid) from public, anon;
grant execute on function sgc.odoo_documento_sync_estado(text, uuid) to authenticated, service_role;

create or replace function sgc.proyecto_cuentas_analiticas_para_oc(p_proyecto_id uuid)
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

create or replace function sgc.oc_elegir_cuenta_analitica(p_orden_id uuid, p_analytic_id bigint)
returns void
language plpgsql security definer set search_path = sgc, pg_temp as $fn$
declare v_proy uuid;
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('compras')) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select proyecto_id into v_proy from sgc.ordenes_compra where id = p_orden_id;
  if not found then raise exception 'Orden de compra no encontrada' using errcode = 'P0002'; end if;
  if p_analytic_id is not null and not exists (
    select 1 from sgc.proyecto_odoo_analiticas a where a.proyecto_id = v_proy and a.odoo_analytic_id = p_analytic_id
  ) then
    raise exception 'La cuenta analitica elegida no pertenece a la obra de esta orden' using errcode = '22023';
  end if;
  update sgc.ordenes_compra set odoo_analytic_elegida = p_analytic_id where id = p_orden_id;
end $fn$;
revoke all on function sgc.oc_elegir_cuenta_analitica(uuid, bigint) from public, anon;
grant execute on function sgc.oc_elegir_cuenta_analitica(uuid, bigint) to authenticated, service_role;

commit;
