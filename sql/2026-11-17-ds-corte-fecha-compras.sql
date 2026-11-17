-- 2026-11-17 -- DS-29: la fecha de corte por bodega la puede cambiar un admin, Tecnologia o Compras (coord_compras), no solo admin.
-- Aplicar la apertura y encender Odoo como fuente del stock (odoo_corte_fuente_set) siguen siendo solo admin.
create or replace function sgc.odoo_corte_configurar(p_bodega uuid, p_fecha date, p_apertura_hecha boolean default false)
returns void language plpgsql security definer set search_path = sgc, pg_temp as $fn$
begin
  if not (sgc.is_admin() or sgc.es_tecnologia() or exists (
    select 1 from sgc.usuarios_roles ur join sgc.roles r on r.id = ur.rol_id where ur.usuario_id = auth.uid() and r.codigo = 'coord_compras')) then
    raise exception 'Solo un administrador o Compras puede configurar el corte.' using errcode = '42501';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha de corte.' using errcode = '22023'; end if;
  -- Compras no puede marcar la apertura como hecha: eso solo lo hace el servidor al aplicarla (o un admin).
  if p_apertura_hecha and not sgc.is_admin() then raise exception 'Solo un administrador marca la apertura.' using errcode = '42501'; end if;
  insert into sgc.odoo_corte_bodega (bodega_id, fecha_corte, apertura_hecha, actualizada_por) values (p_bodega, p_fecha, p_apertura_hecha, auth.uid())
  on conflict (bodega_id) do update set fecha_corte = excluded.fecha_corte, apertura_hecha = case when sgc.is_admin() then excluded.apertura_hecha else sgc.odoo_corte_bodega.apertura_hecha end, actualizada_por = auth.uid(), actualizada_en = now();
end $fn$;
