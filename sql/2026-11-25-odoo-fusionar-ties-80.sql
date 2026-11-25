-- HOTFIX Odoo 19 (25-nov-2026) -- fusiona el duplicado «TIES 80CM» (CSD-03-028, artículo viejo de SGC) con «TIES 80 CM»
-- (ODOO-1221, importado de Odoo el mismo día porque la importación comparaba nombres exactos y no lo reconoció).
-- El artículo importado solo tenía una fila de stock proyectado (se regenera sola desde Odoo en el próximo sondeo), sin
-- ningún otro uso. Se conserva el artículo viejo (con su código y su historial), se vincula al producto 1221 y toma el
-- nombre de Odoo. Idempotente: si ya se fusionó o no existen, no hace nada. Reversa: sql/_reversa/ (no hay datos que perder).
begin;
set local lock_timeout = '3s';
select set_config('sgc.odoo_importando', 'true', true);
select set_config('sgc.odoo_proyectando', 'true', true); -- la fila de stock borrada es proyección de Odoo del artículo duplicado

do $$
declare
  v_viejo uuid; v_nuevo uuid; v_inst uuid; v_tid bigint; r record; n bigint;
begin
  select id into v_viejo from sgc.articulos where codigo = 'CSD-03-028' and odoo_product_id is null;
  select id, odoo_instancia_id, odoo_template_id into v_nuevo, v_inst, v_tid
    from sgc.articulos where codigo = 'ODOO-1221' and odoo_product_id = 1221 and origen = 'odoo';
  if v_viejo is null or v_nuevo is null then
    raise notice 'ties-80: nada que fusionar (ya hecho o no existe)'; return;
  end if;
  -- Salvaguarda: el importado no debe tener más uso que su stock proyectado.
  -- Se recorren TODAS las claves foráneas hacia articulos (salvo el stock proyectado).
  for r in
    select c.conrelid::regclass::text as t, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.confrelid = 'sgc.articulos'::regclass and c.contype = 'f'
       and c.conrelid <> 'sgc.stock_por_bodega'::regclass
  loop
    execute format('select count(*) from %s where %I = %L', r.t, r.col, v_nuevo) into n;
    if n > 0 then raise exception 'ties-80: el artículo importado ya se usó en % (%); fusionar a mano', r.t, n; end if;
  end loop;
  delete from sgc.stock_por_bodega where articulo_id = v_nuevo;
  delete from sgc.articulos where id = v_nuevo;
  update sgc.articulos
     set odoo_product_id = 1221, odoo_template_id = v_tid, odoo_instancia_id = v_inst, odoo_ultima_sync = now(),
         nombre = 'TIES 80 CM'
   where id = v_viejo;
end $$;

commit;
